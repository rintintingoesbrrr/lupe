const Endpoints = {
  TODO_LIST_GET_ALL: {
    number: 1,
    description: "Retrieve all todo items",
    serviceName: "ToDoItemService",
    serviceMethod: "findAll",
    parameters: []
  },
  TODO_LIST_GET_BY_ID: {
    number: 2,
    description: "Retrieve a specific todo item by ID",
    serviceName: "ToDoItemService",
    serviceMethod: "getItemById",
    parameters: ["id"]
  },

  // Helper methods
  getByNumber(number) {
    return Object.values(this).find(
      endpoint => typeof endpoint === 'object' && endpoint.number === number
    ) || null;
  },

  getAllEndpointsFormatted() {
    let result = "";
    for (const [key, endpoint] of Object.entries(this)) {
      if (typeof endpoint !== 'object' || !endpoint.number) continue;
      
      result += `${endpoint.number}. ${endpoint.description}`;
      
      if (endpoint.parameters.length > 0) {
        result += `\n   Required parameters: ${endpoint.parameters.join(", ")}`;
      }
      
      result += "\n";
    }
    return result;
  }
};

Object.freeze(Endpoints);

export { Endpoints };