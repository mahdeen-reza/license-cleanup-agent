-- CreateTable
CREATE TABLE "System" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "foundationalNote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "System_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstanceConfig" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "defaultScope" TEXT NOT NULL,
    "thresholds" JSONB NOT NULL,
    "productAlignment" JSONB,
    "gtmHandling" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReasoningTable" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "confirmedByEmail" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReasoningTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationPattern" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriorException" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriorException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "cleanupType" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "licensesNeeded" INTEGER,
    "ranByEmail" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalUsers" INTEGER NOT NULL,
    "directRemove" INTEGER NOT NULL,
    "notifyFirst" INTEGER NOT NULL,
    "exEmployees" INTEGER NOT NULL,
    "gtmFlagged" INTEGER NOT NULL,
    "priorException" INTEGER NOT NULL,
    "humanReview" INTEGER NOT NULL,
    "excluded" INTEGER NOT NULL,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "businessTitle" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "managerEmail" TEXT NOT NULL,
    "onLeave" TEXT NOT NULL,
    "workerType" TEXT NOT NULL,
    "acquisitionCompany" TEXT,
    "sfCreatedDate" TEXT NOT NULL,
    "lastActivityDate" TEXT,
    "monthlyActivity" INTEGER,
    "sfLastActivityDate" TEXT,
    "sfDaysActive" INTEGER,
    "platformLastDate" TEXT,
    "platformDaysActive" INTEGER,
    "permissionSets" TEXT,
    "profile" TEXT,
    "classification" TEXT NOT NULL,
    "confidenceLevel" TEXT NOT NULL,
    "matchTier" INTEGER NOT NULL,
    "reasoning" TEXT NOT NULL,

    CONSTRAINT "AnalysisResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatOverride" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "targetUserEmail" TEXT NOT NULL,
    "originalClassification" TEXT NOT NULL,
    "newClassification" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessCriteria" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "AccessCriteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriteriaVersion" (
    "id" TEXT NOT NULL,
    "criteriaId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriteriaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "contextType" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "userEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "System_name_key" ON "System"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ReasoningTable_systemId_key" ON "ReasoningTable"("systemId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationPattern_pattern_key" ON "IntegrationPattern"("pattern");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCriteria_instanceId_key" ON "AccessCriteria"("instanceId");

-- AddForeignKey
ALTER TABLE "InstanceConfig" ADD CONSTRAINT "InstanceConfig_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReasoningTable" ADD CONSTRAINT "ReasoningTable_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatOverride" ADD CONSTRAINT "ChatOverride_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriteriaVersion" ADD CONSTRAINT "CriteriaVersion_criteriaId_fkey" FOREIGN KEY ("criteriaId") REFERENCES "AccessCriteria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
