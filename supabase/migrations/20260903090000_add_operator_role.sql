-- Neue Rolle für den technischen Betrieb, getrennt von der Geschäftsführung.
-- Postgres erlaubt einen neuen Enum-Wert erst nach dem Commit zu verwenden,
-- deshalb steht diese Anweisung bewusst allein in einer eigenen Migration.

alter type public.app_role add value if not exists 'operator';
