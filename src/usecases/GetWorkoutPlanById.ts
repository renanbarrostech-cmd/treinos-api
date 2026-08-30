import { NotFoundError } from "../errors/index.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

// Data Transfer Object
interface InputDto {
  userId: string;
  workoutPlanId: string;
}

interface WorkoutDayDto {
  id: string;
  weekDay: WeekDay;
  name: string;
  isRest: boolean;
  coverImageUrl?: string | null;
  estimatedDurationInSeconds: number;
  exercisesCount: number;
}

export interface OutputDto {
  id: string;
  name: string;
  workoutDays: WorkoutDayDto[];
}

export class GetWorkoutPlanById {
  async execute(dto: InputDto): Promise<OutputDto> {
    const workoutPlan = await prisma.workoutPlan.findFirst({
      where: { id: dto.workoutPlanId, userId: dto.userId },
      include: {
        workoutDays: {
          include: { exercises: true },
        },
      },
    });

    if (!workoutPlan) {
      throw new NotFoundError("Workout plan not found");
    }

    return {
      id: workoutPlan.id,
      name: workoutPlan.name,
      workoutDays: workoutPlan.workoutDays.map((workoutDay) => ({
        id: workoutDay.id,
        weekDay: workoutDay.weekDay,
        name: workoutDay.name,
        isRest: workoutDay.isRest,
        coverImageUrl: workoutDay.coverImageUrl,
        estimatedDurationInSeconds: workoutDay.estimatedDurationInSeconds,
        exercisesCount: workoutDay.exercises.length,
      })),
    };
  }
}
