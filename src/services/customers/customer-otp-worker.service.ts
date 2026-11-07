import { randomUUID } from 'node:crypto';
import { CustomerOtpJob } from '../../models/customers/customer-otp-jobs.model.js';
import { deliverCustomerOtp } from '../auth/account-security.service.js';

export async function processCustomerOtpBatch(): Promise<void> {
  for (let count = 0; count < 10; count++) {
    const now = new Date();
    const leaseToken = randomUUID();
    const job = await CustomerOtpJob.findOneAndUpdate(
      {
        runAt: { $lte: now },
        leaseUntil: { $lte: now },
        expiresAt: { $gt: now },
      },
      {
        $set: { leaseToken, leaseUntil: new Date(now.getTime() + 5 * 60_000) },
      },
      { returnDocument: 'after', sort: { runAt: 1, _id: 1 } }
    );
    if (!job) return;
    const claim = { _id: job._id, leaseToken };
    try {
      // Eligibility, account version and resend cooldown are checked at delivery.
      const result = await deliverCustomerOtp(job.email);
      if (result.status === 'deferred' && result.retryAt < job.expiresAt) {
        await CustomerOtpJob.updateOne(claim, {
          $set: { runAt: result.retryAt, leaseUntil: new Date(0) },
          $unset: { leaseToken: 1 },
        });
      } else {
        // An ineligible account or an already delivered code may be skipped.
        // Pending work is retained unless its retry exceeds the job deadline.
        await CustomerOtpJob.deleteOne(claim);
      }
    } catch {
      // A failed cleanup can leave a pending challenge; subsequent work will
      // defer through its cooldown above instead of acknowledging the job.
      console.error('Customer recovery OTP delivery unavailable');
      if (job.attempts >= 2 || job.expiresAt.getTime() <= Date.now()) {
        await CustomerOtpJob.deleteOne(claim);
      } else {
        await CustomerOtpJob.updateOne(claim, {
          $inc: { attempts: 1 },
          $set: {
            runAt: new Date(Date.now() + 5000 * 2 ** job.attempts),
            leaseUntil: new Date(0),
          },
          $unset: { leaseToken: 1 },
        });
      }
    }
  }
}

export function startCustomerOtpWorker() {
  let active: Promise<void> | null = null;
  const tick = () => {
    if (active) return;
    active = processCustomerOtpBatch()
      .catch(() => {
        console.error('Customer recovery OTP worker unavailable');
      })
      .finally(() => {
        active = null;
      });
  };
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    await active;
  };
}
