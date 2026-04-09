-- AlterTable
ALTER TABLE "AnalysisResult" ADD COLUMN     "actionNote" TEXT,
ADD COLUMN     "actionStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "actionedAt" TIMESTAMP(3),
ADD COLUMN     "actionedBy" TEXT,
ADD COLUMN     "deltaCategory" TEXT,
ADD COLUMN     "previousClassification" TEXT;

-- AlterTable
ALTER TABLE "AnalysisRun" ADD COLUMN     "netNew" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "newlyInactive" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "persistentlyInactive" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "previousRunId" TEXT,
ADD COLUMN     "reappeared" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recovered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sporadicFlagged" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SporadicFlag" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "flaggedBy" TEXT NOT NULL,
    "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "removalCount" INTEGER NOT NULL DEFAULT 0,
    "lastRemovedAt" TIMESTAMP(3),
    "lastReappearedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SporadicFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInstanceHistory" (
    "id" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT,
    "classification" TEXT,
    "note" TEXT,
    "actorEmail" TEXT,

    CONSTRAINT "UserInstanceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SporadicFlag_userEmail_instanceName_key" ON "SporadicFlag"("userEmail", "instanceName");

-- CreateIndex
CREATE INDEX "UserInstanceHistory_userEmail_instanceName_eventDate_idx" ON "UserInstanceHistory"("userEmail", "instanceName", "eventDate");

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_previousRunId_fkey" FOREIGN KEY ("previousRunId") REFERENCES "AnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
