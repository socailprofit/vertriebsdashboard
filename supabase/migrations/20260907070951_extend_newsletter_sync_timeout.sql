-- Newsletter metadata pagination can exceed pg_net's five-second default.
select cron.alter_job(jobid, command := replace(command, E'\n    );', E'\n      , timeout_milliseconds := 120000\n    );')) from cron.job where jobname='close_sync_every_15_minutes' and command not like '%timeout_milliseconds%';
