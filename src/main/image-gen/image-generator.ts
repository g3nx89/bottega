import { GoogleGenAI } from '@google/genai';

export interface ImageGenConfig {
  apiKey: string;
  model?: string;
}

export interface GenerateResult {
  success: boolean;
  images: string[]; // base64 PNG data
  error?: string;
}

export const IMAGE_GEN_MODELS = [
  { id: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2 (Flash)' },
  { id: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro' },
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana v1' },
] as const;

export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

/**
 * Gemini image generation wrapper.
 * Extracted from Google's nanobanana extension (Apache 2.0).
 * Returns base64 image data directly — no file I/O.
 */
export class ImageGenerator {
  private ai: GoogleGenAI;
  private modelName: string;

  constructor(config: ImageGenConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.modelName = config.model || DEFAULT_IMAGE_MODEL;
  }

  get model(): string {
    return this.modelName;
  }

  /** Generate a single image from a text prompt. */
  async generate(prompt: string): Promise<GenerateResult> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseModalities: ['TEXT', 'IMAGE'] },
      });
      const images = this.extractImages(response);
      if (images.length === 0) {
        return { success: false, images: [], error: 'No image data in API response' };
      }
      return { success: true, images };
    } catch (error) {
      return { success: false, images: [], error: this.handleError(error) };
    }
  }

  /** Generate multiple images from an array of prompts. Partial failures are tolerated. */
  async generateBatch(prompts: string[], signal?: AbortSignal): Promise<GenerateResult> {
    const allImages: string[] = [];
    let firstError: string | null = null;

    for (const prompt of prompts) {
      if (signal?.aborted) break;
      const result = await this.generate(prompt);
      if (result.success) {
        allImages.push(...result.images);
      } else if (!firstError) {
        firstError = result.error ?? null;
        if (firstError?.toLowerCase().includes('authentication')) break;
      }
    }

    if (allImages.length === 0) {
      return { success: false, images: [], error: firstError || 'No images generated' };
    }
    return { success: true, images: allImages };
  }

  /** Edit an existing image given a text prompt and base64 source image. */
  async edit(prompt: string, imageBase64: string): Promise<GenerateResult> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, { inlineData: { data: imageBase64, mimeType: 'image/png' } }],
          },
        ],
        config: { responseModalities: ['TEXT', 'IMAGE'] },
      });
      const images = this.extractImages(response);
      if (images.length === 0) {
        return { success: false, images: [], error: 'No image data in edit response' };
      }
      return { success: true, images };
    } catch (error) {
      return { success: false, images: [], error: this.handleError(error) };
    }
  }

  private extractImages(response: any): string[] {
    const images: string[] = [];
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!parts) return images;
    for (const part of parts) {
      if (part.inlineData?.data) {
        images.push(part.inlineData.data);
      } else if (part.text && this.isValidBase64(part.text)) {
        images.push(part.text);
      }
    }
    return images;
  }

  private isValidBase64(data: string): boolean {
    if (data.length < 1000) return false;
    // Base64 never contains spaces — reject text/error responses early
    if (data.includes(' ')) return false;
    // Check prefix and suffix only — avoid full-string regex scan on multi-MB base64
    return /^[A-Za-z0-9+/]/.test(data[0]) && /[A-Za-z0-9+/]={0,2}$/.test(data.slice(-4));
  }

  private handleError(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('api key not valid'))
      return 'Invalid Gemini API key. Update it in Settings \u2192 Image Generation.';
    if (msg.includes('permission denied')) return 'Permission denied. Check your API key permissions.';
    if (msg.includes('quota exceeded')) return 'API quota exceeded. Check your Google Cloud usage limits.';
    if (error && typeof error === 'object' && 'response' in error) {
      const status = (error as any).response?.status;
      if (status === 400) return 'Request rejected \u2014 the prompt may violate content safety policies.';
      if (status === 403) return 'Authentication failed. Check your Gemini API key in Settings.';
      if (status === 500) return 'Gemini API temporary error. Try again.';
    }
    return `Image generation failed: ${msg}`;
  }
}
