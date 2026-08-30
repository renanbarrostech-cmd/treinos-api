import {
  NotFoundError,
  WorkoutPlanNotActiveError,
  WorkoutSessionAlreadyStartedError,
} from "../errors/index.js";
import { prisma } from "../lib/db.js";

// Data Transfer Object
interface InputDto {
  userId: string;
  workoutPlanId: string;
  workoutDayId: string;
}

export interface OutputDto {
  id: string;
  workoutDayId: string;
  startedAt: Date;
  completedAt: Date | null;
}

export class StartWorkoutSession {
  async execute(dto: InputDto): Promise<OutputDto> {
    // Transaction - Atomicidade
    return prisma.$transaction(async (tx) => {
      const workoutPlan = await tx.workoutPlan.findUnique({
        where: { id: dto.workoutPlanId },
      });
      if (!workoutPlan || workoutPlan.userId !== dto.userId) {
        throw new NotFoundError("Workout plan not found");
      }

      if (!workoutPlan.isActive) {
        throw new WorkoutPlanNotActiveError("Workout plan is not active");
      }

      const workoutDay = await tx.workoutDay.findUnique({
        where: { id: dto.workoutDayId },
      });
      if (!workoutDay || workoutDay.workoutPlanId !== dto.workoutPlanId) {
        throw new NotFoundError("Workout day not found");
      }

      const openSession = await tx.workoutSession.findFirst({
        where: {
          workoutDayId: dto.workoutDayId,
          completedAt: null,
        },
      });
      if (openSession) {
        throw new WorkoutSessionAlreadyStartedError(
          "Workout session already started for this day",
        );
      }

      const workoutSession = await tx.workoutSession.create({
        data: {
          id: crypto.randomUUID(),
          workoutDayId: dto.workoutDayId,
          startedAt: new Date(),
        },
      });

      return {
        id: workoutSession.id,
        workoutDayId: workoutSession.workoutDayId,
        startedAt: workoutSession.startedAt,
        completedAt: workoutSession.completedAt,
      };
    });
  }
}
