import React from 'react';
import { TasksIcon, PlusIcon } from '../../components/common/Icons';

export default function TasksPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-title">
          <h1>Operational Tasks</h1>
          <p>Task assignments, project delivery deliverables, and milestones (PRD §8.5).</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-primary">
            <PlusIcon size={16} />
            <span>Create Task</span>
          </button>
        </div>
      </div>

      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">
            <TasksIcon size={28} />
          </div>
          <h3>No Open Tasks</h3>
          <p>Tasks assigned to you or your team will appear here.</p>
        </div>
      </div>
    </div>
  );
}
