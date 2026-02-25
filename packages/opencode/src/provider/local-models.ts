import { Log } from "../util/log"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import path from "path"

const log = Log.create({ service: "local-models" })
const CACHE_DIR = path.join(Global.Path.cache, "local-provider-models")
const CACHE_FILE = path.join(CACHE_DIR, "models.json")

export interface LocalModel {
  id: string
  providerID: string
  api: {
    id: string
    url: string
    npm: string
  }
  name: string
  family?: string
  status: "alpha" | "beta" | "deprecated" | "active"
  options: Record<string, any>
  headers: Record<string, string>
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    output: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    interleaved?: boolean | { field: "reasoning_content" | "reasoning_details" }
  }
  cost: {
    input: number
    output: number
    cache?: {
      read?: number
      write?: number
    }
    experimentalOver200K?: {
      input: number
      output: number
      cache?: {
        read?: number
        write?: number
      }
    }
  }
  limit: {
    context: number
    input?: number
    output: number
  }
  release_date: string
  variants?: Record<string, Record<string, any>>
}

export namespace LocalModels {
  export async function fetchModels(baseURL: string, apiKey: string): Promise<LocalModel[]> {
    try {
      const response = await fetch(new URL("/v1/models", baseURL).href, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        log.error("Failed to fetch local models", {
          status: response.status,
          statusText: response.statusText,
        })
        return []
      }

      const data = await response.json()
      
      // Handle OpenAI-compatible response format
      const models = data.data || data.models || []
      
      return models.map((m: any) => ({
        id: m.id,
        providerID: "local-openai",
        api: {
          id: m.id,
          url: new URL(baseURL).origin + "/v1/chat/completions",
          npm: "@ai-sdk/openai-compatible",
        },
        name: m.name || m.id,
        status: "active" as const,
        options: {},
        headers: {},
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: false,
          input: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
        },
        cost: {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: m.context_length || 8192,
          output: m.context_length ? Math.min(m.context_length, 4096) : 4096,
        },
        release_date: new Date().toISOString().split("T")[0],
      }))
    } catch (error) {
      log.error("Error fetching local models", { error })
      return []
    }
  }

  export async function getModels(): Promise<LocalModel[]> {
    // Check if local provider is configured
    const config = await (await import("@/config")).default
    const localProvider = config.provider?.["local-openai"]
    
    if (!localProvider) {
      return []
    }

    const options = localProvider.options || {}
    const baseURL = options.baseURL || "http://127.0.0.1:1234/v1"
    const apiKey = options.apiKey || "none"

    // Check cache
    const cached = await Filesystem.readJson<{ models: LocalModel[]; timestamp: number }>("/tmp/local-models.json")
    if (cached) {
      const now = Date.now()
      const FIVE_MINUTES = 5 * 60 * 1000
      if (now - cached.timestamp < FIVE_MINUTES) {
        log.info("Using cached local models")
        return cached.models
      }
    }

    // Fetch models from local API
    const models = await fetchModels(baseURL, apiKey)
    
    // Cache the models
    try {
      await Filesystem.writeJson("/tmp/local-models.json", {
        models,
        timestamp: Date.now(),
      })
    } catch (e) {
      log.warn("Failed to cache local models", { error: e })
    }

    return models
  }

  export async function clearCache() {
    try {
      await Filesystem.writeJson("/tmp/local-models.json", {
        models: [],
        timestamp: 0,
      })
      log.info("Cleared local models cache")
    } catch (e) {
      log.warn("Failed to clear cache", { error: e })
    }
  }
}