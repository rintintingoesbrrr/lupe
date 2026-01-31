import express from 'express'
import bodyParser from 'body-parser';
import {router} from './routes.js';
import dotenv from 'dotenv/config'

const app = express();
const PORT = process.env.PORT || 5000;

app.use(bodyParser.json());
app.use("/api", router);

app.listen(PORT, () => {
  console.log(`lupe escuchando en el puerto ${PORT}`);
});

