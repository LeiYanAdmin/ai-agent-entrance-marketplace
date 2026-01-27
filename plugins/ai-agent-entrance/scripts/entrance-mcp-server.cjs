#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/mcp/entrance-mcp-server.ts
var import_server = require("@modelcontextprotocol/sdk/server/index.js");
var import_stdio = require("@modelcontextprotocol/sdk/server/stdio.js");
var import_types = require("@modelcontextprotocol/sdk/types.js");
var import_http = __toESM(require("http"), 1);
console.log = (...args) => {
  console.error("[entrance-mcp]", ...args);
};
var WORKER_HOST = process.env.AI_ENTRANCE_WORKER_HOST || "127.0.0.1";
var WORKER_PORT = parseInt(process.env.AI_ENTRANCE_WORKER_PORT || "37778", 10);
var WORKER_BASE = `http://${WORKER_HOST}:${WORKER_PORT}`;
var TOOL_ENDPOINT_MAP = {
  search_knowledge: { method: "GET", path: "/api/knowledge-assets/search" },
  get_asset: { method: "GET", path: "/api/knowledge-assets/get" },
  list_assets: { method: "GET", path: "/api/knowledge-assets/list" },
  sync_knowledge: { method: "POST", path: "/api/sync/trigger" },
  sink_knowledge: { method: "POST", path: "/api/knowledge/sink-asset" },
  read_config: { method: "GET", path: "/api/config/read" },
  write_config: { method: "POST", path: "/api/config/write" },
  git_commit_push: { method: "POST", path: "/api/sync/commit-push" },
  filter_sensitive: { method: "POST", path: "/api/security/filter" },
  get_knowledge_stats: { method: "GET", path: "/api/stats/knowledge" }
};
var TOOLS = [
  {
    name: "search_knowledge",
    description: "\u641C\u7D22\u77E5\u8BC6\u5E93\u8D44\u4EA7\u3002\u652F\u6301\u5168\u6587\u68C0\u7D22\u548C\u8FC7\u6EE4\u3002Search knowledge assets with full-text search.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "\u641C\u7D22\u5173\u952E\u8BCD / Search query" },
        product_line: { type: "string", description: "\u4EA7\u54C1\u7EBF\u8FC7\u6EE4 / Product line filter (e.g. exchange/core)" },
        type: { type: "string", description: "\u8D44\u4EA7\u7C7B\u578B / Asset type (pitfall, adr, best-practice, etc.)" },
        limit: { type: "number", description: "\u8FD4\u56DE\u6570\u91CF / Max results (default: 20)" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_asset",
    description: "\u83B7\u53D6\u77E5\u8BC6\u8D44\u4EA7\u8BE6\u60C5\u3002Get knowledge asset details by ID or name.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "\u8D44\u4EA7ID / Asset ID" },
        name: { type: "string", description: "\u8D44\u4EA7\u540D\u79F0 / Asset name" },
        product_line: { type: "string", description: "\u4EA7\u54C1\u7EBF / Product line (required with name)" }
      }
    }
  },
  {
    name: "list_assets",
    description: "\u5217\u51FA\u77E5\u8BC6\u8D44\u4EA7\u3002List knowledge assets with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "\u6309\u7C7B\u578B\u8FC7\u6EE4 / Filter by type" },
        product_line: { type: "string", description: "\u6309\u4EA7\u54C1\u7EBF\u8FC7\u6EE4 / Filter by product line" },
        promoted: { type: "boolean", description: "\u4EC5\u5DF2\u63A8\u9001 / Only promoted assets" },
        limit: { type: "number", description: "\u8FD4\u56DE\u6570\u91CF / Max results" }
      }
    }
  },
  {
    name: "sync_knowledge",
    description: "\u89E6\u53D1\u77E5\u8BC6\u540C\u6B65 (L1 SQLite \u2194 L2 Git)\u3002Trigger sync between L1 cache and L2 repository.",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["pull", "push", "both"],
          description: "\u540C\u6B65\u65B9\u5411 / Sync direction (default: both)"
        },
        force: { type: "boolean", description: "\u5F3A\u5236\u540C\u6B65 / Force sync even if no changes" }
      }
    }
  },
  {
    name: "sink_knowledge",
    description: "\u6C89\u6DC0\u77E5\u8BC6\u8D44\u4EA7\u5230L1\u7F13\u5B58\u3002Sink a new knowledge asset into L1 cache.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["pitfall", "adr", "glossary", "best-practice", "pattern", "discovery", "skill", "reference"],
          description: "\u8D44\u4EA7\u7C7B\u578B / Asset type"
        },
        name: { type: "string", description: "\u552F\u4E00\u6807\u8BC6\u540D / Unique slug name" },
        product_line: { type: "string", description: "\u4EA7\u54C1\u7EBF / Product line" },
        title: { type: "string", description: "\u6807\u9898 / Title" },
        content: { type: "string", description: "\u5185\u5BB9 / Content (markdown)" },
        tags: { type: "array", items: { type: "string" }, description: "\u6807\u7B7E / Tags" },
        source_project: { type: "string", description: "\u6765\u6E90\u9879\u76EE / Source project path" }
      },
      required: ["type", "name", "product_line", "title", "content"]
    }
  },
  {
    name: "read_config",
    description: "\u8BFB\u53D6\u914D\u7F6E\u503C\u3002Read a configuration value.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "\u914D\u7F6E\u952E\u540D / Config key" }
      },
      required: ["key"]
    }
  },
  {
    name: "write_config",
    description: "\u5199\u5165\u914D\u7F6E\u503C\u3002Write a configuration value.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "\u914D\u7F6E\u952E\u540D / Config key" },
        value: { type: "string", description: "\u914D\u7F6E\u503C / Config value" }
      },
      required: ["key", "value"]
    }
  },
  {
    name: "git_commit_push",
    description: "\u63D0\u4EA4\u5E76\u63A8\u9001L2\u77E5\u8BC6\u4ED3\u5E93\u3002Commit and push L2 knowledge repository.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "\u63D0\u4EA4\u4FE1\u606F / Commit message" }
      }
    }
  },
  {
    name: "filter_sensitive",
    description: "\u68C0\u6D4B\u5E76\u8FC7\u6EE4\u654F\u611F\u4FE1\u606F\u3002Detect and filter sensitive information from content.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "\u5F85\u68C0\u6D4B\u5185\u5BB9 / Content to filter" },
        custom_patterns: {
          type: "array",
          items: { type: "string" },
          description: "\u81EA\u5B9A\u4E49\u6B63\u5219 / Custom regex patterns"
        }
      },
      required: ["content"]
    }
  },
  {
    name: "get_knowledge_stats",
    description: "\u83B7\u53D6\u77E5\u8BC6\u5E93\u7EDF\u8BA1\u4FE1\u606F\u3002Get knowledge base statistics.",
    inputSchema: {
      type: "object",
      properties: {
        product_line: { type: "string", description: "\u6309\u4EA7\u54C1\u7EBF / Filter by product line" }
      }
    }
  }
];
function workerRequest(method, path, params) {
  return new Promise((resolve, reject) => {
    let url = `${WORKER_BASE}${path}`;
    if (method === "GET" && Object.keys(params).length > 0) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== void 0 && value !== null) {
          qs.append(key, String(value));
        }
      }
      url += `?${qs.toString()}`;
    }
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        "Content-Type": "application/json"
      },
      timeout: 3e4
    };
    const req = import_http.default.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch {
          resolve({ success: true, data });
        }
      });
    });
    req.on("error", (err) => {
      reject(new Error(`Worker request failed: ${err.message}. Is the worker service running on ${WORKER_BASE}?`));
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Worker request timed out"));
    });
    if (method !== "GET") {
      req.write(JSON.stringify(params));
    }
    req.end();
  });
}
async function main() {
  const server = new import_server.Server(
    {
      name: "ai-agent-entrance",
      version: "2.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );
  server.setRequestHandler(import_types.ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });
  server.setRequestHandler(import_types.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = args || {};
    const endpoint = TOOL_ENDPOINT_MAP[name];
    if (!endpoint) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Unknown tool: ${name}` })
          }
        ],
        isError: true
      };
    }
    try {
      const result = await workerRequest(endpoint.method, endpoint.path, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: error.message })
          }
        ],
        isError: true
      };
    }
  });
  const transport = new import_stdio.StdioServerTransport();
  await server.connect(transport);
  console.log("MCP server started");
}
main().catch((error) => {
  console.error("MCP server failed to start:", error);
  process.exit(1);
});
