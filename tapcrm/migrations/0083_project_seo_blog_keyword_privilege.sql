-- Target keyword associations are replaced transactionally when a blog is
-- created or edited. The parent SEO records remain non-deletable by the app
-- role; only this join table needs DELETE for removing stale associations.
GRANT DELETE ON project_seo_blog_keyword TO tapcrm_app;
