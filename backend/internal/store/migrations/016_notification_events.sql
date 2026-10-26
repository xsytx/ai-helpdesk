-- Live notifications: every new, changed (folded, read) or removed
-- notification announces itself on the "notification_events" channel; the
-- backend listens and tells that user's open pages at once
-- (GET /api/notifications/stream).
CREATE OR REPLACE FUNCTION notify_notification_change() RETURNS trigger AS $$
DECLARE
    r notifications;
BEGIN
    IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
    PERFORM pg_notify('notification_events',
        json_build_object('user_id', r.user_id, 'thread_id', r.thread_id)::text);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_changed ON notifications;
CREATE TRIGGER notifications_changed
    AFTER INSERT OR UPDATE OR DELETE ON notifications
    FOR EACH ROW EXECUTE FUNCTION notify_notification_change();
