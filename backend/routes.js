import express from 'express'
import * as controller from './controller.js'

const router = express.Router();

router.get("/chat", controller.chatController);

export { router }