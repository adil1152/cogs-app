import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import projectsRouter from "./projects";
import servicesRouter from "./services";
import accessRouter from "./access";
import entriesRouter from "./entries";
import approvalsRouter from "./approvals";
import approversRouter from "./approvers";
import approvalChainRouter from "./approvalChain";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(projectsRouter);
router.use(servicesRouter);
router.use(accessRouter);
router.use(entriesRouter);
router.use(approvalsRouter);
router.use(approversRouter);
router.use(approvalChainRouter);
router.use(reportsRouter);

export default router;
