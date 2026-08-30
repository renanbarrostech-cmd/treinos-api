import dayjs from "dayjs";

import { NotFoundError } from "../errors/index.js";
import { prisma } from "../lib/db.js";

// Data Transfer Object
interface InputDto {
  userId: string;
  workoutPlanId: string;
  workoutDayId: string;
  workoutSessionId: string;
  completedAt: string;
}

export interface OutputDto {
  id: string;
  startedAt: Date;
  completedAt: Date | null;
}

export class UpdateWorkoutSession {
  async execute(dto: InputDto): Promise<OutputDto> {
    const workoutPlan = await prisma.workoutPlan.findUnique({
      where: { id: dto.workoutPlanId },
    });
    if (!workoutPlan || workoutPlan.userId !== dto.userId) {
      throw new NotFoundError("Workout plan not found");
    }

    const workoutDay = await prisma.workoutDay.findUnique({
      where: { id: dto.workoutDayId },
    });
    if (!workoutDay || workoutDay.workoutPlanId !== dto.workoutPlanId) {
      throw new NotFoundError("Workout day not found");
    }

    const workoutSession = await prisma.workoutSession.findUnique({
      where: { id: dto.workoutSessionId },
    });
    if (!workoutSession || workoutSession.workoutDayId !== dto.workoutDayId) {
      throw new NotFoundError("Workout session not found");
    }

    const updatedWorkoutSession = await prisma.workoutSession.update({
      where: { id: dto.workoutSessionId },
      data: {
        completedAt: dayjs(dto.completedAt).toDate(),
      },
    });

    return {
      id: updatedWorkoutSession.id,
      startedAt: updatedWorkoutSession.startedAt,
      completedAt: updatedWorkoutSession.completedAt,
    };
  }
}
