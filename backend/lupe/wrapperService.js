import OpenAI from "openai";

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

export async function askChatGpt(role, content) {
  const completion = await openai.chat.completions.create({
    messages: [{ role: role, content: content }],
    model: "gpt-4o-mini",
  });

  return completion.choices[0];
}

