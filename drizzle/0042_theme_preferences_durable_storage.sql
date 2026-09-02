CREATE TABLE "theme_preferences" (
  "user_id" varchar(64) PRIMARY KEY NOT NULL,
  "theme" varchar(16) NOT NULL DEFAULT 'light',
  "last_seen_changelog_version" varchar(128),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "theme_preferences_theme_check" CHECK ("theme" IN ('light', 'dark')),
  CONSTRAINT "theme_preferences_user_id_nonempty_check" CHECK (char_length(trim("user_id")) > 0)
);

CREATE INDEX "theme_preferences_updated_at_idx" ON "theme_preferences" USING btree ("updated_at");
