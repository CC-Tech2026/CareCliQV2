import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(settingsRouter);

export default router;
