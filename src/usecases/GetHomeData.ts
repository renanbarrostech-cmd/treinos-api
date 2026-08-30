import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

dayjs.extend(utc);

const WEEK_DAYS_BY_INDEX: WeekDay[] = [
  WeekDay.SUNDAY,
  WeekDay.MONDAY,
  WeekDay.TUESDAY,
  WeekDay.WEDNESDAY,
  WeekDay.THURSDAY,
  WeekDay.FRIDAY,
  WeekDay.SATURDAY,
];

const MAX_STREAK_LOOKUP_DAYS = 3660;

// Data Transfer Object
interface InputDto {
  userId: string;
  date: string;
}

interface TodayWorkoutDayDto {
  workoutPlanId: string;
  id: string;
  name: string;
  isRest: boolean;
  weekDay: WeekDay;
  estimatedDurationInSeconds: number;
  coverImageUrl?: string | null;
  exercisesCount: number;
}

interface ConsistencyDayDto {
  workoutDayCompleted: boolean;
  workoutDayStarted: boolean;
}

export interface OutputDto {
  activeWorkoutPlanId: string | null;
  todayWorkoutDay: TodayWorkoutDayDto | null;
  workoutStreak: number;
  consistencyByDay: Record<string, ConsistencyDayDto>;
}

export class GetHomeData {
  async execute(dto: InputDto): Promise<OutputDto> {
    const referenceDate = dayjs.utc(dto.date);
    const weekStart = referenceDate.startOf("week");
    const weekEnd = referenceDate.endOf("week");

    const activeWorkoutPlan = await prisma.workoutPlan.findFirst({
      where: { userId: dto.userId, isActive: true },
      include: {
        workoutDays: {
          include: { exercises: true },
        },
      },
    });

    const todayWeekDay = WEEK_DAYS_BY_INDEX[referenceDate.day()];
    const todayWorkoutDay = activeWorkoutPlan?.workoutDays.find(
      (workoutDay) => workoutDay.weekDay === todayWeekDay,
    );

    const [consistencyByDay, workoutStreak] = await Promise.all([
      this.buildConsistencyByDay({
        userId: dto.userId,
        weekStart,
        weekEnd,
      }),
      activeWorkoutPlan
        ? this.calculateWorkoutStreak({
            workoutDays: activeWorkoutPlan.workoutDays,
            referenceDate,
          })
        : Promise.resolve(0),
    ]);

    return {
      activeWorkoutPlanId: activeWorkoutPlan?.id ?? null,
      todayWorkoutDay: todayWorkoutDay
        ? {
            workoutPlanId: todayWorkoutDay.workoutPlanId,
            id: todayWorkoutDay.id,
            name: todayWorkoutDay.name,
            isRest: todayWorkoutDay.isRest,
            weekDay: todayWorkoutDay.weekDay,
            estimatedDurationInSeconds:
              todayWorkoutDay.estimatedDurationInSeconds,
            coverImageUrl: todayWorkoutDay.coverImageUrl,
            exercisesCount: todayWorkoutDay.exercises.length,
          }
        : null,
      workoutStreak,
      consistencyByDay,
    };
  }

  private async buildConsistencyByDay(params: {
    userId: string;
    weekStart: dayjs.Dayjs;
    weekEnd: dayjs.Dayjs;
  }): Promise<Record<string, ConsistencyDayDto>> {
    const consistencyByDay: Record<string, ConsistencyDayDto> = {};
    for (let i = 0; i < 7; i++) {
      const day = params.weekStart.add(i, "day").format("YYYY-MM-DD");
      consistencyByDay[day] = {
        workoutDayCompleted: false,
        workoutDayStarted: false,
      };
    }

    const sessions = await prisma.workoutSession.findMany({
      where: {
        startedAt: {
          gte: params.weekStart.toDate(),
          lte: params.weekEnd.toDate(),
        },
        workoutDay: {
          workoutPlan: {
            userId: params.userId,
          },
        },
      },
      select: { startedAt: true, completedAt: true },
    });

    for (const session of sessions) {
      const day = dayjs.utc(session.startedAt).format("YYYY-MM-DD");
      const consistencyDay = consistencyByDay[day];
      if (!consistencyDay) continue;

      consistencyDay.workoutDayStarted = true;
      if (session.completedAt) {
        consistencyDay.workoutDayCompleted = true;
      }
    }

    return consistencyByDay;
  }

  private async calculateWorkoutStreak(params: {
    workoutDays: Array<{ id: string; weekDay: WeekDay }>;
    referenceDate: dayjs.Dayjs;
  }): Promise<number> {
    const workoutDayIdByWeekDay = new Map(
      params.workoutDays.map((workoutDay) => [
        workoutDay.weekDay,
        workoutDay.id,
      ]),
    );
    if (workoutDayIdByWeekDay.size === 0) return 0;

    const completedSessions = await prisma.workoutSession.findMany({
      where: {
        workoutDayId: { in: [...workoutDayIdByWeekDay.values()] },
        completedAt: { not: null },
      },
      select: { startedAt: true },
    });

    const completedDates = new Set(
      completedSessions.map((session) =>
        dayjs.utc(session.startedAt).format("YYYY-MM-DD"),
      ),
    );

    let streak = 0;
    let cursor = params.referenceDate;

    for (let i = 0; i < MAX_STREAK_LOOKUP_DAYS; i++) {
      const weekDay = WEEK_DAYS_BY_INDEX[cursor.day()];
      const isScheduledDay = workoutDayIdByWeekDay.has(weekDay);

      if (!isScheduledDay) {
        cursor = cursor.subtract(1, "day");
        continue;
      }

      if (!completedDates.has(cursor.format("YYYY-MM-DD"))) break;

      streak += 1;
      cursor = cursor.subtract(1, "day");
    }

    return streak;
  }
}
