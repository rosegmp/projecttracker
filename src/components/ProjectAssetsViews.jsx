import React, { useEffect, useMemo } from 'react';
import { getVisibleProjectsForUser } from '../utils/accessUi.js';
import ProjectFilesManager from './ProjectFilesManager.jsx';
import ProjectPhotosManager from './ProjectPhotosManager.jsx';
import { DashboardStat, PageStats } from './SharedUI.jsx';

function useScopedProjects(data, activeUser, projectFilter, onProjectFilterChange) {
  const visibleProjects = useMemo(
    () => getVisibleProjectsForUser(data.projects, data.settings, activeUser),
    [activeUser, data.projects, data.settings],
  );
  useEffect(() => {
    if (!visibleProjects.length || (projectFilter !== 'all' && !visibleProjects.some((project) => project.id === projectFilter))) {
      onProjectFilterChange('all');
    }
  }, [onProjectFilterChange, projectFilter, visibleProjects]);
  const selectedProject = projectFilter === 'all' ? null : visibleProjects.find((project) => project.id === projectFilter) || null;
  return { visibleProjects, scopedProjects: selectedProject ? [selectedProject] : visibleProjects };
}

export function NativePhotosView({ data, refresh, loading, onStateChange, readOnly = false, activeUser = null, projectFilter = 'all', onProjectFilterChange = () => {} }) {
  const { visibleProjects, scopedProjects } = useScopedProjects(data, activeUser, projectFilter, onProjectFilterChange);
  const photoCount = scopedProjects.reduce((sum, project) => sum + (project.photos?.length || 0), 0);
  return <section className="panel native-panel workspace-page">
    {visibleProjects.length ? scopedProjects.map((project) => <section key={project.id} className="workspace-section"><h3>{project.name}</h3><ProjectPhotosManager data={data} project={project} onStateChange={onStateChange} readOnly={readOnly} /></section>) : <div className="empty-state"><h3>No projects loaded</h3><p>Create a project first, then add progress photos, site photos, and finish photos here.</p></div>}
    <PageStats settings={data.settings}><DashboardStat label="Projects" value={visibleProjects.length} tone="brand" /><DashboardStat label="Photos" value={photoCount} /></PageStats>
    <div className="page-refresh-footer"><button className="button secondary" type="button" onClick={refresh} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh data'}</button></div>
  </section>;
}

export function NativeFilesView({ data, refresh, loading, onStateChange, readOnly = false, activeUser = null, projectFilter = 'all', onProjectFilterChange = () => {} }) {
  const { visibleProjects, scopedProjects } = useScopedProjects(data, activeUser, projectFilter, onProjectFilterChange);
  const folderCount = scopedProjects.reduce((sum, project) => sum + (project.files?.folders?.length || 0), 0);
  const fileCount = scopedProjects.reduce((sum, project) => sum + (project.files?.folders || []).reduce((folderSum, folder) => folderSum + (folder.files?.length || 0), 0), 0);
  return <section className="panel native-panel workspace-page">
    {visibleProjects.length ? scopedProjects.map((project) => <section className="workspace-section" key={project.id}><h3>{project.name}</h3><ProjectFilesManager data={data} project={project} onStateChange={onStateChange} readOnly={readOnly} /></section>) : <div className="empty-state"><h3>No projects loaded</h3><p>Create a project first, then upload files into Plans, Permits, Surveys, Selections, or your own folders.</p></div>}
    <PageStats settings={data.settings}><DashboardStat label="Projects" value={visibleProjects.length} tone="brand" /><DashboardStat label="Folders" value={folderCount} /><DashboardStat label="Files" value={fileCount} /></PageStats>
    <div className="page-refresh-footer"><button className="button secondary" type="button" onClick={refresh} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh data'}</button></div>
  </section>;
}
