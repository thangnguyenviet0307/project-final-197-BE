import express, { type NextFunction, type Express, type Request, type Response } from 'express';
import createError from 'http-errors';
import cors from 'cors';
import path from 'node:path';
import multer from 'multer';

const app: Express = express();

// Middleware để parse JSON body
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
//Cấu hình tài nguyên tĩnh
app.use(express.static(path.join(__dirname, '../public')));
//enable cors
app.use(cors());

//Middleware cấp độ ứng dụng (Application-level middleware)

/** BEGIN ROUTES */
app.get('/', (req: Request, res: Response) => {
  res.send('Hello World!');
});
//Khai báo route

/** END ROUTES */


/* === KHÔNG SỬA TỪ ĐÂY === */
// Middleware xử lý lỗi 404
app.use((req: Request, res: Response, next) => {
  next(createError(404, 'Not Found'));
});
// Middleware xử lý lỗi
app.use((err: any, req: Request, res: Response, next: NextFunction) => {

  //debug lỗi trên môi truờng development
  if(process.env.NODE_ENV === 'development') {
    console.error('err.stack: ', err.stack);
  }

  // 1. Ưu tiên lấy status/statusCode truyền vào
  let statusCode = err.status || err.statusCode;

  // 2. Nếu là lỗi do chính Multer bắt (ví dụ: Vượt quá 2MB - LIMIT_FILE_SIZE)
  if (err instanceof multer.MulterError) {
    statusCode = 400;
  }

  // 3. Fallback về 500 nếu không xác định được status
  statusCode = statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message,
    statusCode: statusCode,
  });
 
});

export default app;
