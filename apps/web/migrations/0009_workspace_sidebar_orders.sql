CREATE TABLE workspace_sidebar_orders (
  subject TEXT NOT NULL PRIMARY KEY,
  space_order TEXT NOT NULL CHECK (json_type(space_order) = 'array')
) WITHOUT ROWID;
