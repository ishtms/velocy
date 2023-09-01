const http = require("node:http");

class Request {
    #nativeRequest;
    constructor(nativeRequest) {
        this.#nativeRequest = nativeRequest;
        this.extractedParams = Object.create(null);
        this.queryParams = new URLSearchParams();
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
        this.subRoutes = Object.create(null);
        this.routeHandler = Object.create(null);
        this.paramChild = null;
        this.paramName = null;
    }

}

class Router {
    constructor() {
        this.rootNode = new RouteNode();
    }

    #registerRoute(httpMethod, routePath, requestHandler) {
        let currentNode = this.rootNode;
        let pathStart = 1,
            pathEnd = 1,
            pathLength = routePath.length;
        for (; pathEnd <= pathLength; ++pathEnd) {
            if (pathEnd === pathLength || routePath[pathEnd] === "/") {
                let pathSegment = routePath.substring(pathStart, pathEnd);
                let nextNode;
                if (pathSegment[0] === ":") {
                    if (!currentNode.paramChild) {
                        currentNode.paramChild = new RouteNode();
                        currentNode.paramChild.paramName = pathSegment.substring(1);
                    }
                    nextNode = currentNode.paramChild;
                } else {
                    nextNode =
                        currentNode.subRoutes[pathSegment] || (currentNode.subRoutes[pathSegment] = new RouteNode());
                }
                currentNode = nextNode;
                pathStart = pathEnd + 1;
            }
        }
        currentNode.routeHandler[httpMethod] = requestHandler;
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

    #generateNestedRoutes(currentNode, currentPrefix, newRouter) {
        for (const [method, handler] of Object.entries(currentNode.routeHandler)) {
            newRouter.#registerRoute(method, currentPrefix, handler);
        }
        for (const [pathSegment, subNode] of Object.entries(currentNode.subRoutes)) {
            this.#generateNestedRoutes(subNode, `${currentPrefix}/${pathSegment}`, newRouter);
        }
        if (currentNode.paramChild) {
            this.#generateNestedRoutes(
                currentNode.paramChild,
                `${currentPrefix}/:${currentNode.paramChild.paramName}`,
                newRouter
            );
        }
    }

    #mergeNodes(currentNode, nodeToMerge) {
        for (const [method, handler] of Object.entries(nodeToMerge.routeHandler)) {
            currentNode.routeHandler[method] = handler;
        }
        for (const [pathSegment, subNode] of Object.entries(nodeToMerge.subRoutes)) {
            if (!currentNode.subRoutes[pathSegment]) {
                currentNode.subRoutes[pathSegment] = new RouteNode();
            }
            this.#mergeNodes(currentNode.subRoutes[pathSegment], subNode);
        }
        if (nodeToMerge.paramChild) {
            if (!currentNode.paramChild) {
                currentNode.paramChild = new RouteNode();
                currentNode.paramChild.paramName = nodeToMerge.paramChild.paramName;
            }
            this.#mergeNodes(currentNode.paramChild, nodeToMerge.paramChild);
        }
    }

    get(routePath, requestHandler) {
        this.#registerRoute("GET", routePath, requestHandler);
        return this;
    }
    
    post(routePath, requestHandler) {
        this.#registerRoute("POST", routePath, requestHandler);
        return this;
    }

    #findRouteHandler(httpMethod, routePath) {
        let currentNode = this.rootNode;
        let extractedParams = Object.create(null);
        let pathStart = 1,
            pathEnd = 1,
            pathLength = routePath.length;
        for (; pathEnd <= pathLength; ++pathEnd) {
            if (pathEnd === pathLength || routePath[pathEnd] === "/") {
                let pathSegment = routePath.substring(pathStart, pathEnd);
                let nextNode = currentNode.subRoutes[pathSegment];
                if (!nextNode && currentNode.paramChild) {
                    nextNode = currentNode.paramChild;
                    extractedParams[currentNode.paramChild.paramName] = pathSegment;
                }
                if (!nextNode) return null;
                currentNode = nextNode;
                pathStart = pathEnd + 1;
            }
        }
        if (!currentNode.routeHandler[httpMethod]) return null;
        return { requestHandler: currentNode.routeHandler[httpMethod], extractedParams };
    }

    async handleRequest(nativeReq, nativeRes) {
        const req = new Request(nativeReq);
        const res = new Response(nativeRes);

        const queryDelimiter = req.url.indexOf("?");
        const routePath = queryDelimiter === -1 ? req.url : req.url.substring(0, queryDelimiter);
        const routeData = this.#findRouteHandler(req.method, routePath);

        if (!routeData) {
            res.writeHead(404);
            res.end("Route Not Found");
            return;
        }

        req.extractedParams = routeData.extractedParams;
        req.queryParams = new URLSearchParams(queryDelimiter === -1 ? "" : req.url.substring(queryDelimiter)).entries();
        await routeData.requestHandler(req, res);
    }
}
function createServer(router) {
    return http.createServer((req, res) => {
        router.handleRequest(req, res);
    });
}

module.exports = {
    Router,
    createServer,
};
