import { createHash, randomUUID } from 'node:crypto';
import createHttpError from 'http-errors';
import { Types } from 'mongoose';
import type { UploadApiResponse } from 'cloudinary';
import {
  StorePolicy,
  WarrantyRequest,
  type WarrantyDocument,
} from '../models/support.model.js';
import { Order } from '../models/orders.model.js';
import { User } from '../models/users.model.js';
import { OrderStatus } from '../types/orders.type.js';
import type { AuthUser } from '../types/auth.type.js';
import type { ICustomer } from '../types/customers.type.js';
import type {
  CreateWarrantyInput,
  PolicyContent,
  SupportListInput,
  UpdateWarrantyInput,
  WarrantyStatus,
} from '../validations/support.validation.js';
import { buildPagination } from '../utils/pagination.js';
import { configureCloudinary } from '../config/cloudinary.js';
import { getCloudinaryFolder } from '../config/cloudinary-folders.js';
import { validateProductImage } from './product-images.service.js';
import { enqueueImageCleanup } from './image-cleanup.service.js';
import { publicationChanges } from './publication-metadata.js';
import type { EligibleWarrantyOrdersInput } from '../validations/support.validation.js';

const policyId = 'store-policy';
const blankContent: PolicyContent = {
  warranty: '',
  returns: '',
  shipping: '',
  payment: '',
  support: '',
  privacy: '',
};
export const versionConflict = () =>
  createHttpError(
    409,
    'Dữ liệu đã thay đổi. Hãy tải lại và kiểm tra trước khi lưu.',
    { businessCode: 'VERSION_CONFLICT' }
  );
export async function getPolicy(admin = false) {
  const policy = await StorePolicy.findById(policyId).lean();
  if (admin)
    return policy
      ? { ...policy, content: { ...blankContent, ...policy.content } }
      : { content: blankContent, publishedAt: null, __v: 0 };
  return policy?.publishedContent
    ? {
        content: { ...blankContent, ...policy.publishedContent },
        publishedAt: policy.publishedAt,
      }
    : null;
}
export async function savePolicy(input: {
  content: PolicyContent;
  expectedVersion: number;
  publish: boolean;
}) {
  const { content, expectedVersion, publish } = input;
  const current = publish ? await StorePolicy.findById(policyId).lean() : null;
  const now = new Date();
  const metadata = publish
    ? (Object.assign(
        {},
        ...Object.keys(content).map((name) => {
          const key = name as keyof PolicyContent;
          return publicationChanges(
            `publications.${key}`,
            current?.publishedContent?.[key],
            content[key],
            current?.publications?.[key],
            current?.publishedAt,
            now
          );
        })
      ) as Record<string, unknown>)
    : {};
  try {
    const policy = await StorePolicy.findOneAndUpdate(
      { _id: policyId, __v: expectedVersion },
      {
        $set: {
          content,
          ...(publish
            ? {
                publishedContent: content,
                publishedAt: current?.publishedAt ?? now,
                ...metadata,
              }
            : {}),
        },
        $inc: { __v: 1 },
      },
      {
        returnDocument: 'after',
        upsert: expectedVersion === 0,
        runValidators: true,
        setDefaultsOnInsert: false,
      }
    );
    if (!policy) throw versionConflict();
    return policy;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    )
      throw versionConflict();
    throw error;
  }
}

export const nextWarrantyStatuses: Record<
  WarrantyStatus,
  readonly WarrantyStatus[]
> = {
  submitted: ['reviewing'],
  reviewing: ['repairing', 'resolved', 'rejected'],
  repairing: ['resolved', 'rejected'],
  resolved: [],
  rejected: [],
};
export function assertWarrantyTransition(
  current: WarrantyStatus,
  next: WarrantyStatus,
  handlerId: string | null,
  actor: AuthUser
) {
  if (!nextWarrantyStatuses[current].includes(next))
    throw createHttpError(
      409,
      'Không thể chuyển sang trạng thái này. Hãy tải lại yêu cầu.'
    );
  if (
    actor.role === 'staff' &&
    current !== 'submitted' &&
    handlerId !== actor.id
  )
    throw createHttpError(403, 'Bạn chỉ được xử lý yêu cầu do mình phụ trách.');
}
async function handlerNames(docs: readonly WarrantyDocument[]) {
  const ids = [...new Set(docs.filter(doc => doc.handlerId && !doc.handlerName?.trim())
    .map(doc => doc.handlerId!.toString()))];
  if (!ids.length) return new Map<string, string>();
  const users = await User.find({ _id: { $in: ids } }).select('firstName lastName').lean();
  return new Map(users.map(user => [user._id.toString(), `${user.lastName ?? ''} ${user.firstName ?? ''}`.trim()]));
}

export async function getWarrantyDetail(id: string, customerId?: string) {
  const doc = await getWarranty(id, customerId);
  const names = await handlerNames([doc]);
  return warrantyDto(doc, !customerId, names.get(doc.handlerId?.toString() ?? ''));
}

export function warrantyDto(doc: WarrantyDocument, admin: boolean, resolvedName?: string) {
  return {
    _id: doc._id,
    __v: doc.__v,
    orderCode: doc.orderCode,
    productName: doc.productName,
    variantName: doc.variantName,
    description: doc.description,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    handlerName: doc.handlerName?.trim() || resolvedName || (doc.handlerId ? 'Nhân viên cửa hàng' : null),
    ...(admin
      ? {
          handlerId: doc.handlerId,
          customerName: doc.customerName,
          customerEmail: doc.customerEmail,
          customerPhone: doc.customerPhone,
        }
      : {}),
    images: doc.images.map((image) => ({
      _id: image._id,
      url: configureCloudinary().utils.private_download_url(
        image.publicId,
        image.format,
        {
          type: 'authenticated',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          attachment: false,
        }
      ),
    })),
    history: doc.history.map((entry) => ({
      status: entry.status,
      note: entry.note,
      createdAt: entry.createdAt,
      actorName: entry.actorType === 'customer' ? 'Khách hàng' : 'Cửa hàng',
    })),
  };
}
export async function eligibleWarrantyOrders(
  customerId: string,
  query: EligibleWarrantyOrdersInput
) {
  const scope = {
    customerId: new Types.ObjectId(customerId),
    orderStatus: OrderStatus.Completed,
    ...(query.orderId ? { _id: new Types.ObjectId(query.orderId) } : {}),
  };
  const [orders, total] = await Promise.all([
    Order.find(scope)
      .sort({ orderDate: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Order.countDocuments(scope),
  ]);
  return {
    data: orders.map((order) => ({
      _id: order._id,
      orderCode: order.orderCode ?? String(order._id),
      orderDate: order.orderDate,
      items: order.orderItems.map((item, itemIndex) => ({
        itemIndex,
        productName: item.productName ?? 'Sản phẩm đã mua',
        variantName: item.variantName ?? '',
        quantity: item.quantity,
      })),
    })),
    pagination: buildPagination(query.page, query.limit, total),
  };
}
export async function createWarranty(
  customer: ICustomer & { _id: { toString(): string } },
  input: CreateWarrantyInput
) {
  const customerId = customer._id.toString();
  // Built-in _id uniqueness gives durable replay protection without a new unique-index migration.
  const id = createHash('sha256')
    .update(`${customerId}:${input.requestId}`)
    .digest('hex')
    .slice(0, 24);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([input.orderId, input.itemIndex, input.description]))
    .digest('hex');
  const replay = async () => {
    const existing = await WarrantyRequest.findOne({
      _id: id,
      customerId,
    }).select('+fingerprint');
    if (existing && existing.fingerprint !== fingerprint)
      throw createHttpError(
        409,
        'Mã gửi đã được dùng cho nội dung khác. Hãy tải lại danh sách yêu cầu.'
      );
    return existing;
  };
  const existing = await replay();
  if (existing) return warrantyDto(existing, false);
  const order = await Order.findOne({
    _id: input.orderId,
    customerId,
    orderStatus: OrderStatus.Completed,
  }).lean();
  if (!order)
    throw createHttpError(404, 'Không tìm thấy đơn đã hoàn tất của bạn.');
  const item = order.orderItems[input.itemIndex];
  if (!item) throw createHttpError(400, 'Sản phẩm không thuộc đơn hàng này.');
  try {
    const doc = await WarrantyRequest.create({
      _id: id,
      customerId,
      customerName: `${customer.lastName} ${customer.firstName}`.trim(),
      customerEmail: customer.email,
      customerPhone: customer.phone ?? '',
      orderId: order._id,
      orderCode: order.orderCode ?? String(order._id),
      itemIndex: input.itemIndex,
      productName: item.productName ?? 'Sản phẩm đã mua',
      variantName: item.variantName ?? '',
      description: input.description,
      fingerprint,
      history: [
        {
          status: 'submitted',
          note: 'Khách hàng gửi yêu cầu bảo hành.',
          actorId: customerId,
          actorType: 'customer',
        },
      ],
    });
    return warrantyDto(doc, false);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    ) {
      const saved = await replay();
      if (saved) return warrantyDto(saved, false);
    }
    throw error;
  }
}
export async function listWarranties(
  query: SupportListInput,
  customerId?: string
) {
  const scope = {
    ...(customerId ? { customerId: new Types.ObjectId(customerId) } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [docs, total] = await Promise.all([
    WarrantyRequest.find(scope)
      .select('-images -history -fingerprint')
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    WarrantyRequest.countDocuments(scope),
  ]);
  const names = await handlerNames(docs);
  return {
    data: docs.map((doc) => ({
      _id: doc._id,
      orderCode: doc.orderCode,
      productName: doc.productName,
      variantName: doc.variantName,
      status: doc.status,
      createdAt: doc.createdAt,
      handlerName: doc.handlerName?.trim() || names.get(doc.handlerId?.toString() ?? '') || (doc.handlerId ? 'Nhân viên cửa hàng' : null),
      ...(customerId
        ? {}
        : { customerName: doc.customerName, handlerId: doc.handlerId }),
    })),
    pagination: buildPagination(query.page, query.limit, total),
  };
}
export async function getWarranty(id: string, customerId?: string) {
  const doc = await WarrantyRequest.findOne({
    _id: id,
    ...(customerId ? { customerId } : {}),
  });
  if (!doc) throw createHttpError(404, 'Không tìm thấy yêu cầu bảo hành.');
  return doc;
}
export async function updateWarranty(
  id: string,
  actor: AuthUser,
  input: UpdateWarrantyInput
) {
  const doc = await getWarranty(id);
  if (doc.__v !== input.expectedVersion) throw versionConflict();
  assertWarrantyTransition(
    doc.status,
    input.status,
    doc.handlerId?.toString() ?? null,
    actor
  );
  if (doc.history.length >= 200)
    throw createHttpError(409, 'Yêu cầu đã đạt giới hạn lịch sử xử lý.');
  const updated = await WarrantyRequest.findOneAndUpdate(
    { _id: id, __v: input.expectedVersion, status: doc.status },
    {
      $set: {
        status: input.status,
        ...(doc.status === 'submitted' ? {
          handlerId: actor.id,
          handlerName: `${actor.lastName ?? ''} ${actor.firstName ?? ''}`.trim(),
        } : {}),
      },
      $inc: { __v: 1 },
      $push: {
        history: {
          status: input.status,
          note: input.note,
          actorId: actor.id,
          actorType: 'user',
          createdAt: new Date(),
        },
      },
    },
    { returnDocument: 'after', runValidators: true }
  );
  if (!updated) throw versionConflict();
  return warrantyDto(updated, true);
}
export async function addWarrantyImage(
  id: string,
  customerId: string,
  file?: Express.Multer.File
) {
  if (!file) throw createHttpError(400, 'Vui lòng chọn ảnh.');
  validateProductImage(file);
  const doc = await getWarranty(id, customerId);
  const digest = createHash('sha256').update(file.buffer).digest('hex');
  if (doc.images.some((image) => image.digest === digest))
    return warrantyDto(doc, false);
  if (doc.status !== 'submitted' || doc.images.length >= 5)
    throw createHttpError(
      409,
      'Chỉ thêm tối đa 5 ảnh khi yêu cầu đang chờ tiếp nhận.'
    );
  const storage = configureCloudinary();
  const uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = storage.uploader.upload_stream(
      {
        folder: `${getCloudinaryFolder('warranty')}/${id}`,
        public_id: randomUUID(),
        type: 'authenticated',
        resource_type: 'image',
        allowed_formats: ['jpg', 'png', 'webp'],
        overwrite: false,
        timeout: 30000,
        transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
      },
      (error, result) =>
        error || !result
          ? reject(
              createHttpError(502, 'Không thể tải ảnh lên. Vui lòng thử lại.')
            )
          : resolve(result)
    );
    stream.end(file.buffer);
  });
  try {
    if (
      !uploaded.public_id ||
      !['jpg', 'png', 'webp'].includes(uploaded.format)
    )
      throw createHttpError(502, 'Dịch vụ ảnh trả về dữ liệu không hợp lệ.');
    const updated = await WarrantyRequest.findOneAndUpdate(
      {
        _id: id,
        customerId,
        status: 'submitted',
        __v: doc.__v,
        'images.4': { $exists: false },
      },
      {
        $push: {
          images: {
            publicId: uploaded.public_id,
            format: uploaded.format,
            digest,
          },
        },
        $inc: { __v: 1 },
      },
      { returnDocument: 'after', runValidators: true }
    );
    if (!updated) throw versionConflict();
    return warrantyDto(updated, false);
  } catch (error) {
    try {
      const result: { result?: string } = await storage.uploader.destroy(
        uploaded.public_id,
        { type: 'authenticated', resource_type: 'image', invalidate: true }
      );
      if (result.result !== 'ok' && result.result !== 'not found')
        await enqueueImageCleanup(
          [uploaded.public_id],
          undefined,
          'authenticated'
        );
    } catch {
      try {
        await enqueueImageCleanup(
          [uploaded.public_id],
          undefined,
          'authenticated'
        );
      } catch {
        console.error('Warranty image cleanup needs attention', {
          publicId: uploaded.public_id,
        });
      }
    }
    throw error;
  }
}
