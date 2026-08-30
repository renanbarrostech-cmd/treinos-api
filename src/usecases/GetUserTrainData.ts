import { prisma } from "../lib/db.js";

// Data Transfer Object
interface InputDto {
  userId: string;
}

export interface OutputDto {
  userId: string;
  userName: string;
  weightInGrams: number;
  heightInCentimeters: number;
  age: number;
  bodyFatPercentage: number; // 100 representa 100%
}

export class GetUserTrainData {
  async execute(dto: InputDto): Promise<OutputDto | null> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: dto.userId },
    });

    if (
      user.weightInGrams === null ||
      user.heightInCentimeters === null ||
      user.age === null ||
      user.bodyFatPercentage === null
    ) {
      return null;
    }

    return {
      userId: user.id,
      userName: user.name,
      weightInGrams: user.weightInGrams,
      heightInCentimeters: user.heightInCentimeters,
      age: user.age,
      bodyFatPercentage: user.bodyFatPercentage,
    };
  }
}
