-- Fix deferred balance trigger field resolution for journal headers.
CREATE OR REPLACE FUNCTION accounting_assert_journal_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  journal_id uuid;
  debit_total numeric(20, 2);
  credit_total numeric(20, 2);
  line_count integer;
BEGIN
  IF TG_TABLE_NAME = 'journal_entry' THEN
    journal_id := NEW.id;
  ELSE
    journal_id := NEW.journal_entry_id;
  END IF;

  SELECT count(*)::integer, COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
  INTO line_count, debit_total, credit_total
  FROM journal_line
  WHERE organization_id = NEW.organization_id AND journal_entry_id = journal_id;

  IF line_count = 0 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'ACCOUNTING_JOURNAL_UNBALANCED';
  END IF;

  RETURN NULL;
END;
$$;
