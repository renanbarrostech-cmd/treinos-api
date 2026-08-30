import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

// Data Transfer Object
interface InputDto {
  userId: string;
  active?: boolean;
}

interface WorkoutExerciseDto {
  id: string;
  name: string;
  order: number;
  workoutDayId: string;
  sets: number;
  reps: number;
  restTimeInSeconds: number;
}

interface WorkoutDayDto {
  id: string;
  workoutPlanId: string;
  name: string;
  isRest: boolean;
  weekDay: WeekDay;
  estimatedDurationInSeconds: number;
  coverImageUrl?: string | null;
  exercises: WorkoutExerciseDto[];
}

interface WorkoutPlanDto {
  id: string;
  name: string;
  isActive: boolean;
  workoutDays: WorkoutDayDto[];
}

export type OutputDto = WorkoutPlanDto[];

export class ListWorkoutPlans {
  async execute(dto: InputDto): Promise<OutputDto> {
    const workoutPlans = await prisma.workoutPlan.findMany({
      where: {
        userId: dto.userId,
        ...(dto.active !== undefined ? { isActive: dto.active } : {}),
      },
      include: {
        workoutDays: {
          include: { exercises: true },
        },
      },
    });

    return workoutPlans.map((workoutPlan) => ({
      id: workoutPlan.id,
      name: workoutPlan.name,
      isActive: workoutPlan.isActive,
      workoutDays: workoutPlan.workoutDays.map((workoutDay) => ({
        id: workoutDay.id,
        workoutPlanId: workoutDay.workoutPlanId,
        name: workoutDay.name,
        isRest: workoutDay.isRest,
        weekDay: workoutDay.weekDay,
        estimatedDurationInSeconds: workoutDay.estimatedDurationInSeconds,
        coverImageUrl: workoutDay.coverImageUrl,
        exercises: workoutDay.exercises.map((exercise) => ({
          id: exercise.id,
          name: exercise.name,
          order: exercise.order,
          workoutDayId: exercise.workoutDayId,
          sets: exercise.sets,
          reps: exercise.reps,
          restTimeInSeconds: exercise.restTimeInSeconds,
        })),
      })),
    }));
  }
}
