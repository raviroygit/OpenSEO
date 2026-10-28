-- Audits created before projects existed were placeholders (no crawl, score 0)
-- and have no project to belong to; drop them so project_id can be NOT NULL.
DELETE FROM "audits";--> statement-breakpoint
CREATE TABLE "audit_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"page_url" text,
	"code" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "audit_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"url" text NOT NULL,
	"status_code" integer,
	"title" text,
	"load_ms" integer,
	"word_count" integer,
	"depth" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"max_pages" integer DEFAULT 100 NOT NULL,
	"schedule" text DEFAULT 'weekly' NOT NULL,
	"alert_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "project_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "trigger" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "technical_score" integer;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "geo_score" integer;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "pages_crawled" integer;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "issue_counts" jsonb;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_issues" ADD CONSTRAINT "audit_issues_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD CONSTRAINT "audit_pages_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_issues_audit_idx" ON "audit_issues" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audit_pages_audit_idx" ON "audit_pages" USING btree ("audit_id");--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audits_project_created_idx" ON "audits" USING btree ("project_id","created_at");