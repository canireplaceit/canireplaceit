-- `admin` meant two unrelated things: the person who manages an advertiser's
-- team, and the operator of the whole platform. The org-level one becomes
-- `owner`; `admin` now belongs to SITE_ADMIN alone, which is not a membership.
--
-- Custom rather than generated: the role list is a TS-level enum over a plain
-- TEXT column, so `drizzle-kit generate` sees no schema change and the rows are
-- the only thing that has to move.
UPDATE `org_members` SET `role` = 'owner' WHERE `role` = 'admin';
