import Groq from "groq-sdk";
import { env, isGroqConfigured } from "../config/env.js";

export const groqClient = isGroqConfigured ? new Groq({ apiKey: env.GROQ_API_KEY }) : null;
