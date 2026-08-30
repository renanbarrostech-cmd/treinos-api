import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  UIMessage,
} from "ai";
import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import z from "zod";

import { WeekDay } from "../generated/prisma/enums.js";
import { auth } from "../lib/auth.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";

export const aiRoutes = async (app: FastifyInstance) => {
  app.post("/ai", async function (request, reply) {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const { messages } = request.body as { messages: UIMessage[] };
    const result = streamText({
      model: openai("gpt-4o-mini"),
      system: "",
      tools: {
        getUserTrainData: tool({}),
        updateUserTrainData: tool({}),
        getWorkoutPlans: tool({}),
        createWorkoutPlan: tool({
          description: "Cria um novo plano de treino completo",
          inputSchema: z.object({
            name: z.string().describe("Nome do plano de treino"),
            workoutDays: z
              .array(
                z.object({
                  name: z
                    .string()
                    .describe("Nome do dia (ex: Peito e Triceps, Descanso)"),
                  weekDay: z.enum(WeekDay).describe("Dia da semana"),
                  isRest: z
                    .boolean()
                    .describe("Se é dia de descanso (true) ou treino (false)"),
                  estimatedDurationInSeconds: z
                    .number()
                    .describe(
                      "Duração estimada em segundos (0 para dias de descanso",
                    ),
                  coverImageUrl: z
                    .string()
                    .url()
                    .describe(
                      "URL da imagem de capa do dia de treino. Usar as URLs de superior ou inferior conforme o foco muscular do dia.",
                    ),
                  exercises: z
                    .array(
                      z.object({
                        order: z.number().describe("Ordem do exercício no dia"),
                        name: z.string().describe("Nome do exercício"),
                        sets: z.number().describe("Número de séries"),
                        reps: z.number().describe("Número de repetições"),
                        restTimeInSeconds: z
                          .number()
                          .describe(
                            "Tempo de descanso entre séries em segundos",
                          ),
                      }),
                    )
                    .describe(
                      "Lista de exercícios (vazia para dias de descanso)",
                    ),
                }),
              )
              .describe(
                "Array com exatamente 7 dias de treino (MONDAY a SUNDAY)",
              ),
          }),
          execute: async (input) => {
            const createWorkoutplan = new CreateWorkoutPlan();
            const result = await createWorkoutplan.execute({
              userId: session.user.id,
              name: input.name,
              workoutDays: input.workoutDays,
            });
            return result;
          },
        }),
      },
      stopWhen: stepCountIs(5),
      messages: await convertToModelMessages(messages),
    });
    const response = result.toUIMessageStreamResponse();
    reply.status(response.status);
    response.headers.forEach((value, key) => reply.header(key, value));
  });
};
