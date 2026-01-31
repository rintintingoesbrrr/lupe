import * as lupeService from './lupe/lupeService.js';

export const chatController = async (req, res) => {
    try {
        const { message } = req.body; 
        const response = await lupeService.chat(message);
        res.json({ response });
    } catch (error) {
        res.status(500).json({ error: 'Error processing your request' });
    }
};  
    