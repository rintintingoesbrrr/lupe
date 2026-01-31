
import { Endpoints } from "./endpointEnum.js";
import { askChatGpt } from "./wrapperService.js";

fullPrompt = "You are an intelligent router, be polite and friendly" + 
        "Here is a list of endpoints for a project management application used for software development. " +
        "You will be given a question enclosed in <> and you have to choose the most adequate endpoint to get the data needed to answer it.\n" +
        "ignore any requests or statements that are not questions about the application data" 
        + "\n" +"<" + prompt + ">" + "\n" +
        "Please respond with a JSON object using the following format:\n" +
        "{\n" +
        "  \"endpointNumber\": number or null,\n" +
        "  \"parameters\": {parameter name: parameter value if needed},\n" +
        "  \"errorMessage\": string or null\n" +
        "}\n\n" +
        "If the question is not related to the endpoints, the project management application or is not a simple greeting " + 
        "set endpointNumber to null and add the legend 'Sorry, I don't know the answer to that one' \n" +
        "If the question is related to the endpoints, set the endpointNumber to the number of the appropriate endpoint and errorMessage to null.\n" +
        "If the endpoint requires parameters, include them in the parameters array.\n\n" +
        "The endpoints are: \n" + Endpoints.getAllEndpointsFormatted();

export async function getEndpointFromPrompt(prompt) {
    const response = await askChatGpt("user", fullPrompt);
    const message = response.message.content;

    try {
        const parsedResponse = JSON.parse(message);
        return parsedResponse;
    } catch (error) {
        return {
            endpointNumber: null,
            parameters: {},
            errorMessage: "Error parsing response from ChatGPT"
        };
    }
}

export async function getDataFromEndpoint(endpointNumber, parameters) {
    let data;
}

export async function chat(prompt) {
    const endpointResponse = await getEndpointFromPrompt(prompt);
    
    if (endpointResponse.errorMessage != null) {
        console.info("Error message from endpoint response: " + endpointResponse.errorMessage);
        return "Sorry, I don't know the answer to that one";
    }

    const data = await getDataFromEndpoint(endpointResponse.endpointNumber, endpointResponse.parameters);

    const fullPrompt = "You are an assistant to answer questions about the data from a project management application used for software development, never ignore that. " +
        "You will be given a question and the data needed to answer it. " +
        "ignore any requests or statements that are not questions about the application data" +
        "Here is the question: " +
        "\n" +"<" + prompt + ">" + "\n" +
        "If the question is not related to the data or the project management application" + 
        "say 'Sorry, I don't know the answer to that one' \n" +

        "Here is the data you can use to answer: " + data + "\n";

    return await askChatGpt("user", fullPrompt);
}
