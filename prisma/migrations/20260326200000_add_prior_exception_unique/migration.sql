-- AddUniqueConstraint: PriorException(systemId, userEmail)
-- Prevents duplicate exception records for the same user on the same system.
-- Enables safe upsert in the chat route and seed script.

ALTER TABLE "PriorException" ADD CONSTRAINT "PriorException_systemId_userEmail_key" UNIQUE ("systemId", "userEmail");
