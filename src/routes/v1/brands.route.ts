import { Router, type Router as ExpressRouter } from "express";
import brandsController from "../../controllers/brands.controller.js";

const router: ExpressRouter = Router();

router.get("/", brandsController.getAllBrands);
router.post("/", brandsController.createBrand);
router.get("/:id", brandsController.getBrandById);
router.put("/:id", brandsController.updateBrand);
router.delete("/:id", brandsController.deleteBrand);

export default router;
