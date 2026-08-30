import { Readable } from "node:stream";
import { ReadableStream as NodeWebReadableStream } from "node:stream/web";

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
import { ZodTypeProvider } from "fastify-type-provider-zod";
import z from "zod";

import { WeekDay } from "../generated/prisma/enums.js";
import { auth } from "../lib/auth.js";
import { AiChatBodySchema, ErrorSchema } from "../schemas/index.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";
import { GetUserTrainData } from "../usecases/GetUserTrainData.js";
import { ListWorkoutPlans } from "../usecases/ListWorkoutPlans.js";
import { UpsertUserTrainData } from "../usecases/UpsertUserTrainData.js";

const SYSTEM_PROMPT = `Você é um personal trainer virtual, especialista em montagem de planos de treino. Seu público é majoritariamente leigo em musculação, então use uma linguagem simples, amigável e motivadora, sem jargões técnicos. Respostas curtas e objetivas.

## Fluxo obrigatório

1. SEMPRE, antes de qualquer outra ação ou resposta, chame a tool \`getUserTrainData\` para verificar se o usuário já tem dados cadastrados.
2. Se o resultado for null (usuário sem dados cadastrados): pergunte, em uma única mensagem, de forma simples e direta: nome, peso (kg), altura (cm), idade e percentual de gordura corporal (0 a 100). Assim que o usuário responder, salve os dados com a tool \`updateUserTrainData\`, convertendo o peso de kg para gramas (kg * 1000).
3. Se o usuário já tem dados cadastrados: cumprimente-o pelo nome.

## Criando um plano de treino

Quando o usuário quiser um plano de treino, pergunte (poucas perguntas, simples e diretas):
- Qual o objetivo (emagrecer, ganhar massa, condicionamento, etc.)
- Quantos dias por semana ele tem disponível para treinar
- Se tem alguma restrição física ou lesão

Com essas informações, monte um plano com EXATAMENTE 7 dias (MONDAY a SUNDAY). Dias sem treino devem ter \`isRest: true\`, \`exercises: []\` e \`estimatedDurationInSeconds: 0\`. Ao final, chame a tool \`createWorkoutPlan\` para criar o plano.

### Escolha da divisão de treino (split) conforme os dias disponíveis

- 2-3 dias/semana: Full Body ou ABC (A: Peito+Tríceps, B: Costas+Bíceps, C: Pernas+Ombros)
- 4 dias/semana: Upper/Lower (recomendado, cada grupo 2x/semana) ou ABCD (A: Peito+Tríceps, B: Costas+Bíceps, C: Pernas, D: Ombros+Abdômen)
- 5 dias/semana: PPLUL — Push/Pull/Legs + Upper/Lower (superior 3x, inferior 2x/semana)
- 6 dias/semana: PPL 2x — Push/Pull/Legs repetido

### Princípios gerais de montagem

- Agrupe músculos sinérgicos (peito+tríceps, costas+bíceps)
- Exercícios compostos primeiro, isoladores depois
- 4 a 8 exercícios por sessão
- 3-4 séries por exercício; 8-12 repetições para hipertrofia, 4-6 para força
- Descanso entre séries: 60-90s (hipertrofia), 2-3min (compostos pesados)
- Evite treinar o mesmo grupo muscular em dias consecutivos
- Use nomes descritivos para cada dia (ex: "Superior A - Peito e Costas", "Descanso")

### Imagem de capa (coverImageUrl)

SEMPRE defina um \`coverImageUrl\` para cada dia de treino, alternando entre as duas opções de cada categoria para variar.

Dias majoritariamente superiores (peito, costas, ombros, bíceps, tríceps, push, pull, upper, full body) ou de descanso:
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO3y8pQ6GBg8iqe9pP2JrHjwd1nfKtVSQskI0v
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOW3fJmqZe4yoUcwvRPQa8kmFprzNiC30hqftL

Dias majoritariamente inferiores (pernas, glúteos, quadríceps, posterior, panturrilha, legs, lower):
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOgCHaUgNGronCvXmSzAMs1N3KgLdE5yHT6Ykj
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO85RVu3morROwZk5NPhs1jzH7X8TyEvLUCGxY`;

export const aiRoutes = async (app: FastifyInstance) => {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/",
    schema: {
      tags: ["AI"],
      summary: "Conversa com o personal trainer virtual (streaming)",
      body: AiChatBodySchema,
      response: {
        401: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session) {
        return reply
          .status(401)
          .send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }
      const result = streamText({
        model: openai("gpt-4o-mini"),
        system: SYSTEM_PROMPT,
        tools: {
          getUserTrainData: tool({
            description:
              "Retorna os dados de treino cadastrados do usuário (nome, peso em gramas, altura em cm, idade, percentual de gordura corporal de 0 a 100). Retorna null se o usuário ainda não cadastrou os dados. Deve ser chamada antes de qualquer outra interação.",
            inputSchema: z.object({}),
            execute: async () => {
              const getUserTrainData = new GetUserTrainData();
              return getUserTrainData.execute({ userId: session.user.id });
            },
          }),
          updateUserTrainData: tool({
            description: "Salva ou atualiza os dados de treino do usuário.",
            inputSchema: z.object({
              weightInGrams: z
                .number()
                .int()
                .min(1)
                .describe("Peso do usuário em gramas"),
              heightInCentimeters: z
                .number()
                .int()
                .min(1)
                .describe("Altura do usuário em centímetros"),
              age: z.number().int().min(1).describe("Idade do usuário em anos"),
              bodyFatPercentage: z
                .number()
                .int()
                .min(0)
                .max(100)
                .describe(
                  "Percentual de gordura corporal, inteiro de 0 a 100 (100 representa 100%)",
                ),
            }),
            execute: async (input) => {
              const upsertUserTrainData = new UpsertUserTrainData();
              return upsertUserTrainData.execute({
                userId: session.user.id,
                ...input,
              });
            },
          }),
          getWorkoutPlans: tool({
            description: "Lista os planos de treino já criados pelo usuário.",
            inputSchema: z.object({}),
            execute: async () => {
              const listWorkoutPlans = new ListWorkoutPlans();
              return listWorkoutPlans.execute({ userId: session.user.id });
            },
          }),
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
                      .describe(
                        "Se é dia de descanso (true) ou treino (false)",
                      ),
                    estimatedDurationInSeconds: z
                      .number()
                      .describe(
                        "Duração estimada em segundos (0 para dias de descanso",
                      ),
                    coverImageUrl: z
                      .url()
                      .describe(
                        "URL da imagem de capa do dia de treino. Usar as URLs de superior ou inferior conforme o foco muscular do dia.",
                      ),
                    exercises: z
                      .array(
                        z.object({
                          order: z
                            .number()
                            .describe("Ordem do exercício no dia"),
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
        messages: await convertToModelMessages(
          request.body.messages as UIMessage[],
        ),
      });
      const response = result.toUIMessageStreamResponse();
      reply.hijack();
      reply.raw.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) {
        reply.raw.end();
        return;
      }
      Readable.fromWeb(
        response.body as unknown as NodeWebReadableStream<Uint8Array>,
      ).pipe(reply.raw);
    },
  });
};
