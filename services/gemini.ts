import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export interface AnalysisTask {
  title: string;
  assignee: "human" | "agent";
  implementationPlan: {
    id: string;
    stepNumber: number;
    description: string;
    status: "pending" | "in_progress" | "completed" | "failed";
    result?: string;
  }[];
  requiredDeliverables: {
    id: string;
    type: "reply_draft" | "calendar_event" | "reminder" | "document_search";
    description: string;
    status: "pending" | "completed";
    value?: string;
  }[];
}

export interface MessageAnalysis {
  humanTasks: AnalysisTask[];
  agentTasks: AnalysisTask[];
  summary?: string;
}

export async function analyzeMessage(
  messageText: string,
  sender: string,
  context?: string,
): Promise<MessageAnalysis> {
  const prompt = `You are Synced, an AI assistant that automatically analyzes incoming messages, extracts tasks, and splits them into Human and Agent categories.

Analyze the following message from "${sender}" and return a JSON object.
Message: "${messageText}"
${context ? `Context: ${context}` : ""}

Return ONLY valid JSON in this exact format (no markdown code blocks, return raw text):
{
  "summary": "One-line summary of what this message is about",
  "humanTasks": [
    {
      "title": "Short task title the human has to complete",
      "implementationPlan": [
        { "id": "step_1", "stepNumber": 1, "description": "Read and review documents", "status": "pending" }
      ],
      "requiredDeliverables": [
        { "id": "del_1", "type": "document_search|reminder", "description": "Brief description", "status": "pending" }
      ]
    }
  ],
  "agentTasks": [
    {
      "title": "Short task title the AI agent has completed automatically (must be past tense)",
      "implementationPlan": [
        { "id": "step_a1", "stepNumber": 1, "description": "Description of action (e.g. Queried Google Drive)", "status": "completed", "result": "Located file" }
      ],
      "requiredDeliverables": [
        { "id": "del_a1", "type": "reply_draft|calendar_event|reminder|document_search", "description": "Brief description", "status": "completed", "value": "Content generated" }
      ]
    }
  ]
}

Rules:
- Generate 1-2 human tasks (assignee: 'human') for requests requiring user action or review. Keep status at 'pending'.
- Generate 1-3 agent tasks (assignee: 'agent') representing automation (e.g., search, reminder, draft reply).
- For agent tasks, write plans in the PAST TENSE (e.g. 'Drafted email', 'Set reminder') and mark status as 'completed' with realistic 'result' and deliverable 'value' text.
- Ensure all ids are unique.
- Keep titles under 5 words.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    const text = response.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]);

    const sanitizeTasks = (
      tasks: any[] = [],
      assignee: "human" | "agent",
    ): AnalysisTask[] => {
      return tasks.map((t, idx) => ({
        title:
          t.title ??
          (assignee === "human" ? "Action Required" : "Action Taken"),
        assignee,
        implementationPlan: (t.implementationPlan ?? []).map(
          (step: any, sIdx: number) => ({
            id: step.id ?? `step_${assignee}_${idx}_${sIdx}`,
            stepNumber: step.stepNumber ?? sIdx + 1,
            description: step.description ?? "Execute task step",
            status:
              step.status ?? (assignee === "human" ? "pending" : "completed"),
            result: step.result,
          }),
        ),
        requiredDeliverables: (t.requiredDeliverables ?? []).map(
          (del: any, dIdx: number) => ({
            id: del.id ?? `del_${assignee}_${idx}_${dIdx}`,
            type:
              del.type ?? (assignee === "human" ? "reminder" : "reply_draft"),
            description: del.description ?? "Deliverable description",
            status:
              del.status ?? (assignee === "human" ? "pending" : "completed"),
            value: del.value,
          }),
        ),
      }));
    };

    return {
      summary: parsed.summary || "Message analyzed",
      humanTasks: sanitizeTasks(parsed.humanTasks, "human"),
      agentTasks: sanitizeTasks(parsed.agentTasks, "agent"),
    };
  } catch {
    return {
      summary: "Automated response generated",
      humanTasks: [
        {
          title: `Follow up with ${sender}`,
          assignee: "human",
          implementationPlan: [
            {
              id: "h_step_1",
              stepNumber: 1,
              description: "Review message content and complete requests",
              status: "pending",
            },
          ],
          requiredDeliverables: [
            {
              id: "h_del_1",
              type: "reminder",
              description: "Complete follow-up",
              status: "pending",
            },
          ],
        },
      ],
      agentTasks: [
        {
          title: "Drafted response",
          assignee: "agent",
          implementationPlan: [
            {
              id: "a_step_1",
              stepNumber: 1,
              description: "Drafted reply to message",
              status: "completed",
              result: "Drafted reply.",
            },
          ],
          requiredDeliverables: [
            {
              id: "a_del_1",
              type: "reply_draft",
              description: "Drafted response",
              status: "completed",
              value: "I will look into this and get back to you shortly.",
            },
          ],
        },
      ],
    };
  }
}
