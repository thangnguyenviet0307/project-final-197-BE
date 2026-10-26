import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import Product from '../dist/models/products.model.js';
import { Order } from '../dist/models/orders.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { ImageCleanupJob } from '../dist/models/image-cleanup-jobs.model.js';
import service from '../dist/services/products.service.js';
import { processImageCleanupBatch } from '../dist/services/image-cleanup.service.js';

test('product deletion queues only managed gallery assets in the deletion transaction', async t => {
 const session={}; t.mock.method(mongoose.connection,'transaction',async fn=>fn(session));
 t.mock.method(SystemLock,'updateOne',async()=>({acknowledged:true}));
 t.mock.method(Order,'exists',()=>({session:async()=>null}));
 t.mock.method(Product,'findByIdAndDelete',async()=>new Product({images:[{public_id:'managed/id',secure_url:'https://image.example/a'}],thumbnail:'https://external.example/image'}));
 const jobs=t.mock.method(ImageCleanupJob,'bulkWrite',async (ops,opts)=>{assert.equal(opts.session,session);assert.deepEqual(ops.map(op=>op.updateOne.filter),[{publicId:'managed/id'}]);});
 await service.deleteProduct(String(new mongoose.Types.ObjectId()));assert.equal(jobs.mock.callCount(),1);
});
test('cleanup failure schedules retry and already-removed storage assets finish idempotently', async t => {
 const saved={...process.env};t.after(()=>{for(const key of ['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']) {if(saved[key]===undefined) delete process.env[key];else process.env[key]=saved[key];}});
 for(const key of ['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']) process.env[key]='test';
 const job={_id:new mongoose.Types.ObjectId(),publicId:'managed/id',attempts:0};let next=job;
 t.mock.method(ImageCleanupJob,'findOneAndUpdate',async()=>{const result=next;next=null;return result;});
 const retry=t.mock.method(ImageCleanupJob,'updateOne',async()=>({acknowledged:true}));
 const remove=t.mock.method(ImageCleanupJob,'deleteOne',async()=>({deletedCount:1}));
 const destroy=t.mock.method(cloudinary.uploader,'destroy',async()=>{throw new Error('Unavailable');});
 await processImageCleanupBatch();assert.equal(retry.mock.callCount(),1);assert.equal(remove.mock.callCount(),0);
 next=job;destroy.mock.mockImplementation(async()=>({result:'not found'}));
 await processImageCleanupBatch();assert.equal(remove.mock.callCount(),1);
});
