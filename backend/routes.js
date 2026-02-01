import express from 'express'
import * as controller from './controller.js'

const router = express.Router();

router.get("/chat", controller.chatController);

//crud

router.post("/activity", controller.createActivityController);
router.get("/activity/:id", controller.getActivityController);
router.get("/activity", controller.getAllActivitiesController);
router.put("/activity/:id", controller.updateActivityController);
router.delete("/activity/:id", controller.deleteActivityController);

//gets
router.get("/users", controller.getUsersController);
router.get("/coeficients", controller.getCoefficientsController);



export { router }