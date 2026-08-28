import { useState } from 'react';
import DepartmentsTab from '../modules/organization/DepartmentsTab';
import PositionsTab from '../modules/organization/PositionsTab';
import TeamsTab from '../modules/organization/TeamsTab';
import DesignationsTab from '../modules/organization/DesignationsTab';
import './Organizations.css';

type OrgTab = 'departments' | 'positions' | 'teams' | 'designations';

export default function Organizations() {
  const [activeTab, setActiveTab] = useState<OrgTab>('departments');

  return (
    <div className="organizations-container">
      <div className="organizations-header-card">
        <div className="organizations-title">
          <h2>Organization Architecture</h2>
          <p>Configure departments, authority positions, sub-teams, and designations (TECH.md §5.3, PRD §8.2).</p>
        </div>

        {/* SUB-TABS */}
        <div className="org-tabs-nav">
          <button
            type="button"
            className={`org-tab-btn ${activeTab === 'departments' ? 'active' : ''}`}
            onClick={() => setActiveTab('departments')}
          >
            🏢 Departments
          </button>
          <button
            type="button"
            className={`org-tab-btn ${activeTab === 'positions' ? 'active' : ''}`}
            onClick={() => setActiveTab('positions')}
          >
            🪜 Positions Ladder
          </button>
          <button
            type="button"
            className={`org-tab-btn ${activeTab === 'teams' ? 'active' : ''}`}
            onClick={() => setActiveTab('teams')}
          >
            👥 Teams & Sub-Teams
          </button>
          <button
            type="button"
            className={`org-tab-btn ${activeTab === 'designations' ? 'active' : ''}`}
            onClick={() => setActiveTab('designations')}
          >
            🏷️ Designations
          </button>
        </div>
      </div>

      <div className="org-tab-body">
        {activeTab === 'departments' && <DepartmentsTab />}
        {activeTab === 'positions' && <PositionsTab />}
        {activeTab === 'teams' && <TeamsTab />}
        {activeTab === 'designations' && <DesignationsTab />}
      </div>
    </div>
  );
}
