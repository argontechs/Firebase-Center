ALTER TABLE "apps" ADD CONSTRAINT "apps_company_id_name_unique" UNIQUE("company_id","name");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_name_unique" UNIQUE("name");