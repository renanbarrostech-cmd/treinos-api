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
  from: string;
  to: string;
}

interface ConsistencyDayDto {
  workoutDayCompleted: boolean;
  workoutDayStarted: boolean;
}

export interface OutputDto {
  workoutStreak: number;
  consistencyByDay: Record<string, ConsistencyDayDto>;
  completedWorkoutsCount: number;
  conclusionRate: number;
  totalTimeInSeconds: number;
}

export class GetStats {
  async execute(dto: InputDto): Promise<OutputDto> {
    const from = dayjs.utc(dto.from).startOf("day");
    const to = dayjs.utc(dto.to).endOf("day");

    const sessions = await prisma.workoutSession.findMany({
      where: {
        startedAt: {
          gte: from.toDate(),
          lte: to.toDate(),
        },
        workoutDay: {
          workoutPlan: {
            userId: dto.userId,
          },
        },
      },
      select: { startedAt: true, completedAt: true },
    });

    const consistencyByDay: Record<string, ConsistencyDayDto> = {};
    let completedWorkoutsCount = 0;
    let totalTimeInSeconds = 0;

    for (const session of sessions) {
      const day = dayjs.utc(session.startedAt).format("YYYY-MM-DD");
      const consistencyDay = consistencyByDay[day] ?? {
        workoutDayCompleted: false,
        workoutDayStarted: false,
      };

      consistencyDay.workoutDayStarted = true;
      if (session.completedAt) {
        consistencyDay.workoutDayCompleted = true;
        completedWorkoutsCount += 1;
        totalTimeInSeconds += dayjs
          .utc(session.completedAt)
          .diff(dayjs.utc(session.startedAt), "second");
      }

      consistencyByDay[day] = consistencyDay;
    }

    const conclusionRate =
      sessions.length === 0 ? 0 : completedWorkoutsCount / sessions.length;

    const workoutStreak = await this.calculateWorkoutStreak({
      userId: dto.userId,
      referenceDate: to,
    });

    return {
      workoutStreak,
      consistencyByDay,
      completedWorkoutsCount,
      conclusionRate,
      totalTimeInSeconds,
    };
  }

  private async calculateWorkoutStreak(params: {
    userId: string;
    referenceDate: dayjs.Dayjs;
  }): Promise<number> {
    const activeWorkoutPlan = await prisma.workoutPlan.findFirst({
      where: { userId: params.userId, isActive: true },
      include: { workoutDays: true },
    });
    if (!activeWorkoutPlan) return 0;

    const workoutDayIdByWeekDay = new Map(
      activeWorkoutPlan.workoutDays.map((workoutDay) => [
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
