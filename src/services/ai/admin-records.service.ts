import createError from 'http-errors';
import { Types } from 'mongoose';
import { AiCounter, AiRiskEvent, AiTurn } from '../../models/ai/ai.model.js';

export type AiRecordKind = 'failures' | 'usage' | 'risks';
const live = () => ({ expiresAt: { $gt: new Date() } });
const failures = () => ({
  ...live(),
  status: 'failed' as const,
  error: { $exists: true },
  adminFailureDismissedAt: null,
});
const usage = () => ({ ...live(), _id: /^provider-global:\d+$/ });

export async function readAdminRecords(
  kind: AiRecordKind,
  requestedPage: number,
  limit: number
) {
  // Separate queries retain typed Mongoose projections and never return chat content or actor hashes.
  const query =
    kind === 'failures' ? failures() : kind === 'usage' ? usage() : live();
  const total =
    kind === 'failures'
      ? await AiTurn.countDocuments(query)
      : kind === 'usage'
        ? await AiCounter.countDocuments(query)
        : await AiRiskEvent.countDocuments(query);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / limit)));
  const skip = (page - 1) * limit;
  const rows =
    kind === 'failures'
      ? await AiTurn.find(query)
          .sort({ updatedAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .select('_id error updatedAt')
          .lean()
      : kind === 'usage'
        ? await AiCounter.find(query)
            .sort({ expiresAt: -1, _id: -1 })
            .skip(skip)
            .limit(limit)
            .select('_id count')
            .lean()
        : await AiRiskEvent.find(query)
            .sort({ createdAt: -1, _id: -1 })
            .skip(skip)
            .limit(limit)
            .select('_id event reason score createdAt updatedAt')
            .lean();
  return { rows, total, page, limit };
}

export async function deleteAdminRecord(
  kind: AiRecordKind,
  id: string,
  version: string | number
) {
  if (kind === 'usage') {
    if (!/^provider-global:\d+$/.test(id) || typeof version !== 'number')
      throw createError(400, 'Bản ghi lượt gọi không hợp lệ.');
    const result = await AiCounter.deleteOne({
      ...usage(),
      _id: id,
      count: version,
    });
    if (!result.deletedCount) throw changed();
  } else {
    if (
      !/^[a-f\d]{24}$/i.test(id) ||
      typeof version !== 'string' ||
      !Number.isFinite(Date.parse(version))
    )
      throw createError(400, 'Bản ghi hoặc phiên bản dữ liệu không hợp lệ.');
    const updatedAt = new Date(version);
    if (kind === 'failures') {
      // Dismiss only the admin diagnostic entry. Preserve conversation, error, TTL and timestamps.
      const result = await AiTurn.updateOne(
        { ...failures(), _id: new Types.ObjectId(id), updatedAt },
        { $set: { adminFailureDismissedAt: new Date() } },
        { timestamps: false }
      );
      if (!result.modifiedCount) throw changed();
    } else {
      const result = await AiRiskEvent.deleteOne({
        ...live(),
        _id: id,
        updatedAt,
      });
      if (!result.deletedCount) throw changed();
    }
  }
}
function changed() {
  return createError(
    409,
    'Bản ghi đã thay đổi hoặc đã được xóa. Vui lòng tải lại và xác nhận lại.'
  );
}
