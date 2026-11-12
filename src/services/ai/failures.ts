import createError from 'http-errors';

export type AiStage =
  'intent' | 'embedding' | 'retrieval' | 'generation' | 'persistence';
const messages = {
  AI_UNAVAILABLE:
    'Trợ lý AI hiện chưa sẵn sàng. Bạn có thể tìm sản phẩm trong cửa hàng và quay lại sau.',
  AI_CREDIT_EXHAUSTED:
    'Trợ lý AI tạm chưa khả dụng do hạn mức dịch vụ. Bạn có thể tìm sản phẩm trong cửa hàng và quay lại sau.',
  AI_RATE_LIMITED:
    'Trợ lý đang nhận nhiều yêu cầu. Vui lòng thử lại sau ít phút.',
  AI_USAGE_LIMIT: 'Đã đạt giới hạn sử dụng AI. Vui lòng thử lại sau.',
  AI_TIMEOUT:
    'Trợ lý mất quá nhiều thời gian để trả lời. Vui lòng thử lại sau.',
  AI_OUTPUT_LIMIT:
    'Câu trả lời vượt giới hạn xử lý. Bạn có thể hỏi ngắn gọn hơn hoặc tách thành từng câu hỏi.',
  AI_AUTH_ERROR:
    'Trợ lý AI tạm chưa kết nối được dịch vụ. Vui lòng thử lại sau.',
  AI_INVALID_RESPONSE:
    'Trợ lý chưa nhận được câu trả lời hợp lệ. Vui lòng thử lại sau.',
  AI_PROVIDER_ERROR: 'Dịch vụ AI đang gặp sự cố. Bạn có thể thử lại sau.',
  AI_RETRIEVAL_ERROR:
    'Chưa đọc được dữ liệu cửa hàng để trả lời. Vui lòng thử lại sau.',
  AI_PERSISTENCE_ERROR:
    'Chưa xác nhận được việc lưu câu trả lời. Hãy tải lại lịch sử để kiểm tra.',
} as const;
export type AiFailureCode = keyof typeof messages;
export interface AiFailure {
  code: AiFailureCode;
  message: string;
  stage: AiStage;
  retryable: boolean;
}
function record(error: unknown): Record<string, unknown> {
  return error && typeof error === 'object'
    ? (error as Record<string, unknown>)
    : {};
}
export function aiError(code: AiFailureCode, status = 502, stage?: AiStage) {
  return createError(status, messages[code], { aiCode: code, aiStage: stage });
}
export function classifyAiFailure(error: unknown, stage: AiStage): AiFailure {
  const value = record(error);
  if (
    ['intent', 'embedding', 'retrieval', 'generation', 'persistence'].includes(
      String(value['aiStage'])
    )
  )
    stage = value['aiStage'] as AiStage;
  const nested = record(value['error']);
  const providerCode = value['code'] ?? nested['code'];
  const status = value['status'] ?? value['statusCode'];
  let code: AiFailureCode;
  if (
    typeof value['aiCode'] === 'string' &&
    Object.hasOwn(messages, value['aiCode'])
  )
    code = value['aiCode'] as AiFailureCode;
  else if (
    [
      'credit_balance_exhausted',
      'insufficient_quota',
      'billing_hard_limit_reached',
    ].includes(String(providerCode))
  )
    code = 'AI_CREDIT_EXHAUSTED';
  else if (status === 401 || status === 403) code = 'AI_AUTH_ERROR';
  else if (status === 429) code = 'AI_RATE_LIMITED';
  else if (
    status === 408 ||
    status === 504 ||
    ['TimeoutError', 'APIConnectionTimeoutError'].includes(
      String(value['name'])
    )
  )
    code = 'AI_TIMEOUT';
  else if (stage === 'persistence') code = 'AI_PERSISTENCE_ERROR';
  else if (stage === 'retrieval') code = 'AI_RETRIEVAL_ERROR';
  else code = 'AI_PROVIDER_ERROR';
  return {
    code,
    message: messages[code],
    stage,
    retryable: ![
      'AI_UNAVAILABLE',
      'AI_CREDIT_EXHAUSTED',
      'AI_AUTH_ERROR',
      'AI_USAGE_LIMIT',
    ].includes(code),
  };
}
export function reportAiFailure(
  error: unknown,
  stage: AiStage,
  requestId?: string
) {
  const failure = classifyAiFailure(error, stage);
  // Never log provider messages, prompts, credentials, bodies or stack traces.
  console.warn('AI request failed', {
    code: failure.code,
    stage,
    ...(requestId && /^[a-zA-Z0-9_-]{1,80}$/.test(requestId)
      ? { requestId }
      : {}),
  });
  return failure;
}
