const http = require("node:http");

class Router {
    constructor() {
        this.rootNode = new RouteNode();
    }

    #generateNestedRoutes(currentNode, currentPrefix, newRouter) {
        for (const [method, handler] of Object.entries(currentNode.handler)) {
            newRouter.addRoute(method, currentPrefix, handler);
        }
        for (const [pathSegment, subNode] of Object.entries(currentNode.children)) {
            this.#generateNestedRoutes(subNode, `${currentPrefix}/${pathSegment}`, newRouter);
        }
        if (currentNode.param) {
            this.#generateNestedRoutes(
                currentNode.param,
                `${currentPrefix}/:${currentNode.param.paramName}`,
                newRouter
            );
        }
    }

    addRoute(httpMethod, routePath, requestHandler) {
        let currentNode = this.rootNode;
        let pathStart = 1,
            pathEnd = 1,
            pathLength = routePath.length;
        for (; pathEnd <= pathLength; ++pathEnd) {
            if (pathEnd === pathLength || routePath[pathEnd] === "/") {
                let pathSegment = routePath.substring(pathStart, pathEnd);
                let nextNode;
                if (pathSegment[0] === ":") {
                    if (!currentNode.param) {
                        currentNode.param = new RouteNode();
                        currentNode.param.paramName = pathSegment.substring(1);
                    }
                    nextNode = currentNode.param;
                } else {
                    nextNode =
                        currentNode.children[pathSegment] || (currentNode.children[pathSegment] = new RouteNode());
                }
                currentNode = nextNode;
                pathStart = pathEnd + 1;
            }
        }
        currentNode.handler[httpMethod] = requestHandler;
    }

    #mergeNodes(currentNode, nodeToMerge) {
        for (const [method, handler] of Object.entries(nodeToMerge.handler)) {
            currentNode.handler[method] = handler;
        }
        for (const [pathSegment, subNode] of Object.entries(nodeToMerge.children)) {
            if (!currentNode.children[pathSegment]) {
                currentNode.children[pathSegment] = new RouteNode();
            }
            this.#mergeNodes(currentNode.children[pathSegment], subNode);
        }
        if (nodeToMerge.param) {
            if (!currentNode.param) {
                currentNode.param = new RouteNode();
                currentNode.param.paramName = nodeToMerge.param.paramName;
            }
            this.#mergeNodes(currentNode.param, nodeToMerge.param);
        }
    }

    printTree() {
        this.#printNode(this.rootNode, "Root");
    }

    #printNode(node, prefix, level = 0, prefixSymbol = "") {
        let indentation = " ".repeat(level * 4);

        console.log(`${prefixSymbol ? `${indentation}${prefixSymbol} ${prefix || "/"}` : prefix}`);

        // Print handlers for this node
        for (const [method, handler] of Object.entries(node.handler)) {
            const handlerName =
                handler.name ||
                handler
                    .toString()
                    .replace(/[\n]/g, "")
                    .replace(/[\s]{2,}/g, " ")
                    .substring(0, 30) + "...";
            console.log(`${indentation}    └─ [${method}] ↠  ${handlerName}`);
        }

        // Recursively print children
        for (const [childPrefix, childNode] of Object.entries(node.children)) {
            this.#printNode(childNode, childPrefix, level + 1, "├─");
        }

        // Recursively print parameterized child
        if (node.param) {
            this.#printNode(node.param, `:${node.param.paramName}`, level + 1, "├─");
        }
    }

    async handleRequest(nativeReq, nativeRes) {
        // const req = new Request(nativeReq);
        // const res = new Response(nativeRes);

        const { method, url } = nativeReq;
        const queryDelimiter = url.indexOf("?");
        const routePath = queryDelimiter === -1 ? url : url.substring(0, queryDelimiter);
        const routeHandler = this.#findRouteHandler(method, routePath);

        if (!routeHandler) {
            nativeRes.writeHead(404);
            nativeRes.end("Route Not Found");
            return;
        }

        nativeReq.params = routeHandler.extractedParams;
        nativeReq.queryParams = new URLSearchParams(queryDelimiter === -1 ? "" : url.substring(queryDelimiter));

        const routeHandlerFunc = routeHandler.requestHandler[routePath] || routeHandler.requestHandler;

        if (typeof routeHandlerFunc === "function") {
            await routeHandlerFunc(nativeReq, nativeRes);
        } else {
            res.writeHead(404);
            res.end("Route Not Found");
        }
    }

    #findRouteHandler(httpMethod, routePath) {
        let currentNode = this.rootNode;
        let extractedParams = Object.create(null);
        let pathStart = 1;
        const pathLength = routePath.length;
        const stack = [];

        for (let pathEnd = 1; pathEnd <= pathLength; ++pathEnd) {
            if (pathEnd === pathLength || routePath[pathEnd] === "/") {
                const pathSegment = routePath.substring(pathStart, pathEnd);
                let nextNode = currentNode.children[pathSegment];

                while (!nextNode && currentNode.param) {
                    nextNode = currentNode.param;
                    extractedParams[currentNode.param.paramName] = pathSegment;
                    pathStart = pathEnd + 1;
                }

                if (!nextNode) return null;

                stack.push({ node: nextNode, param: extractedParams });

                currentNode = nextNode;
                pathStart = pathEnd + 1;
            }
        }

        if (!currentNode.handler[httpMethod]) return null;
        return { requestHandler: currentNode.handler[httpMethod], extractedParams };
    }

    get(routePath, requestHandler) {
        this.addRoute("GET", routePath, requestHandler);
        return this;
    }

    post(routePath, requestHandler) {
        this.addRoute("POST", routePath, requestHandler);
        return this;
    }

    put(routePath, requestHandler) {
        this.addRoute("PUT", routePath, requestHandler);
        return this;
    }

    delete(routePath, requestHandler) {
        this.addRoute("DELETE", routePath, requestHandler);
        return this;
    }

    patch(routePath, requestHandler) {
        this.addRoute("PATCH", routePath, requestHandler);
        return this;
    }

    merge(routerToMerge) {
        this.#mergeNodes(this.rootNode, routerToMerge.rootNode);
    }

    nest(prefix, routerToNest) {
        this.#nestNodes(this.rootNode, routerToNest.rootNode, prefix);
        return this;
    }

    #nestNodes(currentNode, nodeToNest, prefix) {
        const newRouter = new Router();
        this.#generateNestedRoutes(nodeToNest, prefix, newRouter);
        this.#mergeNodes(currentNode, newRouter.rootNode);
    }
}

class Request {
    #nativeRequest;
    constructor(nativeRequest) {
        this.#nativeRequest = nativeRequest;
        this.extractedParams = Object.create(null);
        this.queryParams = new URLSearchParams();
    }

    set params(params) {
        this.extractedParams = Object.freeze({ ...params });
    }

    get params() {
        return Object.freeze({ ...this.extractedParams });
    }

    get method() {
        return this.#nativeRequest.method;
    }

    get url() {
        return this.#nativeRequest.url;
    }
}

class Response {
    #nativeResponse;

    constructor(nativeResponse) {
        this.#nativeResponse = nativeResponse;
    }

    writeHead(statusCode, headers) {
        this.#nativeResponse.writeHead(statusCode, headers);
    }

    end(data) {
        this.#nativeResponse.end(data);
    }
}

class RouteNode {
    constructor() {
        this.handler = Object.create(null);
        this.children = Object.create(null);
        this.param = null;
        this.paramName = null;
    }
}

function createServer(router) {
    return http.createServer((req, res) => {
        router.handleRequest(req, res);
    });
}

class SimpleRouter {
    constructor() {
        this.routes = Object.create(null);
    }

    addRoute(httpMethod, routePath, requestHandler) {
        const route = this.routes[routePath] || (this.routes[routePath] = Object.create(null));
        route[httpMethod] = requestHandler;
    }

    handleRequest(req, res) {
        const routeHandler = this.routes[req.url];

        if (!routeHandler || !routeHandler[req.method]) {
            res.writeHead(404);
            res.end("Route Not Found");
            return;
        }

        routeHandler[req.method](req, res);
    }

    get(routePath, requestHandler) {
        this.addRoute("GET", routePath, requestHandler);
        return this;
    }

    post(routePath, requestHandler) {
        this.addRoute("POST", routePath, requestHandler);
        return this;
    }

    put(routePath, requestHandler) {
        this.addRoute("PUT", routePath, requestHandler);
        return this;
    }

    delete(routePath, requestHandler) {
        this.addRoute("DELETE", routePath, requestHandler);
        return this;
    }

    patch(routePath, requestHandler) {
        this.addRoute("PATCH", routePath, requestHandler);
        return this;
    }
}

module.exports = {
    Router,
    createServer,
    SimpleRouter,
};
