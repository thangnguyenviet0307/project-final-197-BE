import { type Request, type Response, type RequestHandler } from "express";
import { CategoriesService } from "../services/categories.service.js";
import { asyncHandler } from "../utils/async-handler.util.js";

export class CategoriesController {
  // 1. Create categories
  public static createCategories: RequestHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const categories = await CategoriesService.createCategory(req.body);
    res.status(201).json({
      success: true,
      message: "Categories created successfully",
      data: categories,
    });
  });

  // 2. Get all categories
  public static getAllCategories: RequestHandler = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const categoriesList = await CategoriesService.getAllCategories();
    res.status(200).json({
      success: true,
      count: categoriesList.length,
      data: categoriesList,
    });
  });

  // 3. Get categories by ID
  public static getCategoriesById: RequestHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const categories = await CategoriesService.getCategoryById(req.params["id"] as string);
    res.status(200).json({
      success: true,
      data: categories,
    });
  });

  // 4. Update categories
  public static updateCategories: RequestHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const updatedCategories = await CategoriesService.updateCategory(req.params["id"] as string, req.body);
    res.status(200).json({
      success: true,
      message: "Categories updated successfully",
      data: updatedCategories,
    });
  });

  // 5. Delete categories
  public static deleteCategories: RequestHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    await CategoriesService.deleteCategory(req.params["id"] as string);
    res.status(200).json({
      success: true,
      message: "Categories deleted successfully",
    });
  });
}