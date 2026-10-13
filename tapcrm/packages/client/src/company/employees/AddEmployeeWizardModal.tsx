import { useEffect, useState } from 'react';
import {
  getCompanyLadder,
  getCompanyReportingManagers,
  type CompanyDepartment,
  type CompanyDesignation,
  type CompanyLadderPosition,
  type CompanyReportingManager,
  type CompanyTeam,
} from '../api/companyApi.js';
import type { ShiftTemplate } from '../api/shiftsApi.js';
import { createEmployee, getNextEmployeeId, type CreateEmployeeInput } from '../api/employeesApi.js';
import { IdentityApiError } from '../../identity/api/authApi.js';

interface AddEmployeeWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (fullName: string, employeeId: string, workflowId: string, setupUrl?: string) => void;
  departments: CompanyDepartment[];
  teams: CompanyTeam[];
  designations: CompanyDesignation[];
  shifts: ShiftTemplate[];
}

type WizardFieldErrors = {
  // Stage 1: Basic Info
  fullName?: string;
  email?: string;
  employeeId?: string;
  departmentId?: string;
  positionId?: string;
  joiningDate?: string;

  // Stage 2: Personal Info
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;

  // Stage 3: Shift & Skills
  shiftId?: string;
  skills?: string;
  newSkillName?: string;

  // Stage 4: Qualification
  qualifications?: string;
  qualificationDraft?: string;

  // Stage 5: Password & Security
  password?: string;
  confirmPassword?: string;
};

function flattenPositions(
  positions: CompanyLadderPosition[],
  depth = 0,
): Array<{ value: string; label: string }> {
  return positions.flatMap((position) => [
    {
      value: position.id,
      label: `${'— '.repeat(depth)}${position.name} (${position.code})`,
    },
    ...flattenPositions(position.children ?? [], depth + 1),
  ]);
}

export function AddEmployeeWizardModal({
  isOpen,
  onClose,
  onSuccess,
  departments,
  teams,
  designations,
  shifts,
}: AddEmployeeWizardModalProps): React.JSX.Element | null {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<WizardFieldErrors>({});

  // Dynamic positions and managers
  const [positions, setPositions] = useState<Array<{ value: string; label: string }>>([]);
  const [managers, setManagers] = useState<CompanyReportingManager[]>([]);
  const [rootPositionIds, setRootPositionIds] = useState<Set<string>>(new Set());

  // Stage 1: Basic Information
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [loadingEmployeeId, setLoadingEmployeeId] = useState(false);
  const [joiningDate, setJoiningDate] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [reportsTo, setReportsTo] = useState('');

  async function handleAutoGenerateEmployeeId(): Promise<void> {
    setLoadingEmployeeId(true);
    try {
      const res = await getNextEmployeeId(employeeId.trim() || undefined);
      setEmployeeId(res.nextEmployeeId);
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.employeeId;
        return next;
      });
    } catch {
      setEmployeeId('EMP-00001');
    } finally {
      setLoadingEmployeeId(false);
    }
  }

  function handleAutoGeneratePassword(): void {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*()_+-=';
    const all = upper + lower + digits + symbols;
    const pwd = [
      upper[Math.floor(Math.random() * upper.length)] ?? 'A',
      lower[Math.floor(Math.random() * lower.length)] ?? 'b',
      digits[Math.floor(Math.random() * digits.length)] ?? '7',
      symbols[Math.floor(Math.random() * symbols.length)] ?? '#',
    ];
    for (let i = pwd.length; i < 16; i++) {
      pwd.push(all[Math.floor(Math.random() * all.length)] ?? 'x');
    }
    const result = pwd.sort(() => Math.random() - 0.5).join('');
    setPassword(result);
    setConfirmPassword(result);
    setShowPassword(true);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.password;
      delete next.confirmPassword;
      return next;
    });
  }

  // Pre-load next sequence on mount
  useEffect(() => {
    if (!isOpen) return;
    if (!employeeId) {
      void handleAutoGenerateEmployeeId();
    }
  }, [isOpen]);

  // Fetch positions whenever departmentId changes
  useEffect(() => {
    const department = departments.find((d) => d.id === departmentId);
    if (!department) {
      setPositions([]);
      setRootPositionIds(new Set());
      return;
    }
    getCompanyLadder(department.code)
      .then((ladder) => {
        setPositions(flattenPositions(ladder.positions));
        setRootPositionIds(new Set(ladder.positions.map((p) => p.id)));
      })
      .catch(() => setError('Unable to load positions for this department.'));
  }, [departmentId, departments]);

  const isRootPosition = positionId !== '' && rootPositionIds.has(positionId);

  // Fetch managers whenever placement changes
  useEffect(() => {
    if (!departmentId || !positionId || isRootPosition) {
      setManagers([]);
      if (isRootPosition && reportsTo !== '') {
        setReportsTo('');
      }
      return;
    }
    getCompanyReportingManagers(departmentId, positionId, undefined, teamId || undefined)
      .then(setManagers)
      .catch(() => setError('Unable to load reporting managers.'));
  }, [departmentId, positionId, teamId, isRootPosition]);

  // Stage 2: Personal Information
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [emergencyContactRelation, setEmergencyContactRelation] = useState('');

  // Stage 3: Shift & Skills
  const [shiftId, setShiftId] = useState('');
  const [skillsList, setSkillsList] = useState<Array<{ skillName: string; proficiency: 'beginner' | 'intermediate' | 'advanced' | 'expert' }>>([]);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillProficiency, setNewSkillProficiency] = useState<'beginner' | 'intermediate' | 'advanced' | 'expert'>('intermediate');

  // Stage 4: Qualification
  const [qualificationsList, setQualificationsList] = useState<Array<{ institution: string; degree: string; fieldOfStudy: string; passingYear: string; grade: string }>>([]);
  const [institution, setInstitution] = useState('');
  const [degree, setDegree] = useState('');
  const [fieldOfStudy, setFieldOfStudy] = useState('');
  const [passingYear, setPassingYear] = useState('');
  const [grade, setGrade] = useState('');

  // Stage 5: Email & Account Setup
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  if (!isOpen) return null;

  const departmentTeams = teams.filter((t) => t.departmentId === departmentId);
  const designation = designations.find((d) => d.id === designationId);

  function clearFieldError(field: keyof WizardFieldErrors): void {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function focusFirstError(errors: WizardFieldErrors): void {
    const firstKey = Object.keys(errors)[0];
    if (firstKey) {
      setTimeout(() => {
        let el = document.getElementById(`wizard-${firstKey}`);
        if (!el && firstKey === 'skills') {
          el = document.getElementById('wizard-newSkillName');
        }
        if (!el && (firstKey === 'qualifications' || firstKey === 'qualificationDraft')) {
          el = document.getElementById('wizard-institution');
        }
        if (el) {
          el.focus();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }

  function validateStep(s: number): boolean {
    const errs: WizardFieldErrors = {};
    if (s === 1) {
      const trimmedName = fullName.trim();
      if (!trimmedName) {
        errs.fullName = 'Full name is required.';
      } else if (trimmedName.length < 2) {
        errs.fullName = 'Full name must be at least 2 characters.';
      } else if (trimmedName.length > 160) {
        errs.fullName = 'Full name must be at most 160 characters.';
      }

      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        errs.email = 'Corporate email is required.';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        errs.email = 'Please enter a valid corporate email address.';
      } else if (trimmedEmail.length > 320) {
        errs.email = 'Email must be at most 320 characters.';
      }

      const trimmedEmpId = employeeId.trim();
      if (trimmedEmpId && !/^[A-Z0-9][A-Z0-9-]{0,49}$/i.test(trimmedEmpId)) {
        errs.employeeId = 'Employee ID must be alphanumeric with hyphens (max 50 chars).';
      }

      if (!departmentId.trim()) {
        errs.departmentId = 'Department is required.';
      }

      if (!positionId.trim()) {
        errs.positionId = 'Position is required.';
      }

      if (!joiningDate.trim()) {
        errs.joiningDate = 'Joining date is required.';
      } else if (isNaN(Date.parse(joiningDate))) {
        errs.joiningDate = 'Please enter a valid joining date.';
      }
    } else if (s === 2) {
      const trimmedPhone = phone.trim();
      if (!trimmedPhone) {
        errs.phone = 'Contact phone is required.';
      } else if (trimmedPhone.length > 30) {
        errs.phone = 'Phone number must be at most 30 characters.';
      }

      if (!dateOfBirth.trim()) {
        errs.dateOfBirth = 'Date of birth is required.';
      } else if (isNaN(Date.parse(dateOfBirth))) {
        errs.dateOfBirth = 'Please enter a valid date of birth.';
      }

      if (!gender.trim()) {
        errs.gender = 'Gender is required.';
      }

      const trimmedAddr1 = addressLine1.trim();
      if (!trimmedAddr1) {
        errs.addressLine1 = 'Street address line 1 is required.';
      } else if (trimmedAddr1.length > 255) {
        errs.addressLine1 = 'Address line 1 must be at most 255 characters.';
      }

      const trimmedCity = city.trim();
      if (!trimmedCity) {
        errs.city = 'City is required.';
      } else if (trimmedCity.length > 100) {
        errs.city = 'City must be at most 100 characters.';
      }

      const trimmedState = state.trim();
      if (!trimmedState) {
        errs.state = 'State is required.';
      } else if (trimmedState.length > 100) {
        errs.state = 'State must be at most 100 characters.';
      }

      const trimmedPostal = postalCode.trim();
      if (!trimmedPostal) {
        errs.postalCode = 'Postal code is required.';
      } else if (trimmedPostal.length > 20) {
        errs.postalCode = 'Postal code must be at most 20 characters.';
      }

      const trimmedEmgName = emergencyContactName.trim();
      if (!trimmedEmgName) {
        errs.emergencyContactName = 'Emergency contact name is required.';
      } else if (trimmedEmgName.length > 160) {
        errs.emergencyContactName = 'Name must be at most 160 characters.';
      }

      const trimmedEmgPhone = emergencyContactPhone.trim();
      if (!trimmedEmgPhone) {
        errs.emergencyContactPhone = 'Emergency contact phone is required.';
      } else if (trimmedEmgPhone.length > 30) {
        errs.emergencyContactPhone = 'Emergency contact phone must be at most 30 characters.';
      }

      const trimmedEmgRel = emergencyContactRelation.trim();
      if (!trimmedEmgRel) {
        errs.emergencyContactRelation = 'Emergency contact relationship is required.';
      } else if (trimmedEmgRel.length > 60) {
        errs.emergencyContactRelation = 'Relationship must be at most 60 characters.';
      }
    } else if (s === 3) {
      if (!shiftId.trim()) {
        errs.shiftId = 'Please select a shift schedule.';
      }

      if (skillsList.length === 0) {
        if (newSkillName.trim()) {
          setSkillsList([{ skillName: newSkillName.trim(), proficiency: newSkillProficiency }]);
          setNewSkillName('');
        } else {
          errs.skills = 'At least one skill is required.';
        }
      }
    } else if (s === 4) {
      if (qualificationsList.length === 0) {
        if (institution.trim() && degree.trim()) {
          setQualificationsList([
            {
              institution: institution.trim(),
              degree: degree.trim(),
              fieldOfStudy: fieldOfStudy.trim(),
              passingYear: passingYear.trim(),
              grade: grade.trim(),
            },
          ]);
          setInstitution('');
          setDegree('');
          setFieldOfStudy('');
          setPassingYear('');
          setGrade('');
        } else {
          errs.qualifications = 'At least one qualification is required.';
        }
      }
    } else if (s === 5) {
      if (!password) {
        errs.password = 'Temporary password is required.';
      } else if (password.length < 12) {
        errs.password = 'Password must be at least 12 characters.';
      } else if (password.length > 200) {
        errs.password = 'Password must be at most 200 characters.';
      }

      if (!confirmPassword) {
        errs.confirmPassword = 'Confirm password is required.';
      } else if (password !== confirmPassword) {
        errs.confirmPassword = 'Passwords do not match.';
      }
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusFirstError(errs);
      return false;
    }
    return true;
  }

  function handleNext(): void {
    if (!validateStep(step)) return;
    if (step < 5) setStep((prev) => (prev + 1) as 1 | 2 | 3 | 4 | 5);
  }

  function handleBack(): void {
    if (step > 1) setStep((prev) => (prev - 1) as 1 | 2 | 3 | 4 | 5);
  }

  function addSkill(): void {
    if (!newSkillName.trim()) {
      setFieldErrors((prev) => ({ ...prev, newSkillName: 'Skill name is required.' }));
      return;
    }
    setSkillsList([...skillsList, { skillName: newSkillName.trim(), proficiency: newSkillProficiency }]);
    setNewSkillName('');
    clearFieldError('skills');
    clearFieldError('newSkillName');
  }

  function removeSkill(index: number): void {
    setSkillsList(skillsList.filter((_, i) => i !== index));
  }

  function addQualification(): void {
    if (!institution.trim() || !degree.trim()) {
      setFieldErrors((prev) => ({
        ...prev,
        qualificationDraft: 'Institution and degree are required to add qualification.',
      }));
      return;
    }
    setQualificationsList([
      ...qualificationsList,
      {
        institution: institution.trim(),
        degree: degree.trim(),
        fieldOfStudy: fieldOfStudy.trim(),
        passingYear: passingYear.trim(),
        grade: grade.trim(),
      },
    ]);
    setInstitution('');
    setDegree('');
    setFieldOfStudy('');
    setPassingYear('');
    setGrade('');
    clearFieldError('qualifications');
    clearFieldError('qualificationDraft');
  }

  function removeQualification(index: number): void {
    setQualificationsList(qualificationsList.filter((_, i) => i !== index));
  }

  async function handleSubmit(): Promise<void> {
    for (const s of [1, 2, 3, 4, 5] as const) {
      if (!validateStep(s)) {
        if (step !== s) {
          setStep(s);
        }
        return;
      }
    }
    setBusy(true);
    setError('');

    const personalInfo: NonNullable<CreateEmployeeInput['personalInfo']> = {};
    if (phone.trim()) personalInfo.phone = phone.trim();
    if (dateOfBirth) personalInfo.dateOfBirth = dateOfBirth;
    if (gender) personalInfo.gender = gender;
    if (addressLine1.trim()) personalInfo.addressLine1 = addressLine1.trim();
    if (addressLine2.trim()) personalInfo.addressLine2 = addressLine2.trim();
    if (city.trim()) personalInfo.city = city.trim();
    if (state.trim()) personalInfo.state = state.trim();
    if (postalCode.trim()) personalInfo.postalCode = postalCode.trim();
    if (emergencyContactName.trim()) personalInfo.emergencyContactName = emergencyContactName.trim();
    if (emergencyContactPhone.trim()) personalInfo.emergencyContactPhone = emergencyContactPhone.trim();
    if (emergencyContactRelation.trim()) personalInfo.emergencyContactRelation = emergencyContactRelation.trim();

    const qualifications: NonNullable<CreateEmployeeInput['qualifications']> = qualificationsList.map((q) => {
      const item: NonNullable<CreateEmployeeInput['qualifications']>[number] = {
        institution: q.institution,
        degree: q.degree,
      };
      if (q.fieldOfStudy) item.fieldOfStudy = q.fieldOfStudy;
      if (q.passingYear) item.passingYear = parseInt(q.passingYear, 10);
      if (q.grade) item.grade = q.grade;
      return item;
    });

    const payload: CreateEmployeeInput = {
      ...(employeeId.trim() ? { employeeId: employeeId.trim().toUpperCase() } : {}),
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      password,
      confirmPassword,
      departmentId,
      positionId,
      ...(teamId ? { teamId } : {}),
      ...(designationId ? { designationId } : {}),
      ...(specialization ? { specialization } : {}),
      reportsTo: reportsTo || null,
      ...(joiningDate ? { joiningDate } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(Object.keys(personalInfo).length > 0 ? { personalInfo } : {}),
      ...(shiftId ? { shiftId } : {}),
      ...(qualifications.length > 0 ? { qualifications } : {}),
      ...(skillsList.length > 0 ? { skills: skillsList } : {}),
    };

    try {
      const res = await createEmployee(payload);
      onSuccess(res.employee.fullName, res.employee.id, res.onboardingWorkflowId, res.setupUrl);
    } catch (cause) {
      if (cause instanceof IdentityApiError) {
        setError(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to create employee.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
    >
      <div className="fixed inset-0 bg-[#080e17a6] backdrop-blur-xs transition-opacity" onClick={onClose} />

      <dialog
        open
        className="ui-dialog z-50 my-auto flex max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3.5rem)] w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] max-w-2xl flex-col rounded-2xl border border-app-border bg-app-surface p-5 sm:p-6 shadow-2xl text-app-foreground overflow-hidden"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-app-border pb-4">
          <div>
            <h2 className="font-display text-xl font-bold">New Employee Onboarding</h2>
            <p className="text-xs text-app-muted mt-0.5">Multi-stage employee creation & onboarding setup</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="grid size-8 place-items-center rounded-lg text-xl text-app-muted hover:bg-app-background"
          >
            ×
          </button>
        </div>

        {/* Stepper Wizard Bar */}
        <div className="shrink-0 my-4 flex items-center justify-between px-2 text-xs font-semibold">
          {[
            { id: 1, label: '1. Basic Info' },
            { id: 2, label: '2. Personal' },
            { id: 3, label: '3. Shift & Skills' },
            { id: 4, label: '4. Qualification' },
            { id: 5, label: '5. Email Setup' },
          ].map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-1.5 ${
                step === item.id
                  ? 'text-app-accent font-bold'
                  : step > item.id
                  ? 'text-emerald-500'
                  : 'text-app-muted'
              }`}
            >
              <span
                className={`grid size-5 place-items-center rounded-full text-[10px] ${
                  step === item.id
                    ? 'bg-app-accent text-app-on-accent'
                    : step > item.id
                    ? 'bg-emerald-500 text-white'
                    : 'bg-app-border text-app-muted'
                }`}
              >
                {step > item.id ? '✓' : item.id}
              </span>
              <span className="hidden sm:inline">{item.label}</span>
            </div>
          ))}
        </div>

        {error && (
          <div className="shrink-0 mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
            {error}
          </div>
        )}

        {/* Modal Form Body */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-4">
          {step === 1 && (
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div>
                <label htmlFor="wizard-fullName" className="mb-1 block text-xs font-semibold text-app-muted">Full Name *</label>
                <input
                  id="wizard-fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    clearFieldError('fullName');
                  }}
                  placeholder="e.g. John Doe"
                  className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                    fieldErrors.fullName ? 'border-red-500' : 'border-app-border'
                  }`}
                />
                {fieldErrors.fullName && <p className="mt-1 text-xs text-red-500">{fieldErrors.fullName}</p>}
              </div>

              <div>
                <label htmlFor="wizard-email" className="mb-1 block text-xs font-semibold text-app-muted">Corporate Email *</label>
                <input
                  id="wizard-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFieldError('email');
                  }}
                  placeholder="john.doe@company.com"
                  className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                    fieldErrors.email ? 'border-red-500' : 'border-app-border'
                  }`}
                />
                {fieldErrors.email && <p className="mt-1 text-xs text-red-500">{fieldErrors.email}</p>}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="wizard-employeeId" className="block text-xs font-semibold text-app-muted">Employee ID (Optional)</label>
                  <button
                    type="button"
                    onClick={() => void handleAutoGenerateEmployeeId()}
                    disabled={loadingEmployeeId}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-app-accent hover:underline disabled:opacity-50"
                  >
                    {loadingEmployeeId ? 'Fetching…' : '⚡ Auto-generate'}
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="wizard-employeeId"
                    type="text"
                    value={employeeId}
                    onChange={(e) => {
                      setEmployeeId(e.target.value.toUpperCase());
                      clearFieldError('employeeId');
                    }}
                    placeholder="e.g. EMP-00001 (or click Auto)"
                    className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm uppercase outline-none focus:border-app-accent ${
                      fieldErrors.employeeId ? 'border-red-500' : 'border-app-border'
                    }`}
                  />
                  {employeeId && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-app-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-app-accent">
                      Assigned
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-app-muted">
                  Auto-generates sequence based on DB records, or enter custom.
                </p>
                {fieldErrors.employeeId && <p className="mt-1 text-xs text-red-500">{fieldErrors.employeeId}</p>}
              </div>

              <div>
                <label htmlFor="wizard-departmentId" className="mb-1 block text-xs font-semibold text-app-muted">Department *</label>
                <select
                  id="wizard-departmentId"
                  required
                  value={departmentId}
                  onChange={(e) => {
                    setDepartmentId(e.target.value);
                    setPositionId('');
                    setTeamId('');
                    setReportsTo('');
                    clearFieldError('departmentId');
                  }}
                  className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                    fieldErrors.departmentId ? 'border-red-500' : 'border-app-border'
                  }`}
                >
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                {fieldErrors.departmentId && <p className="mt-1 text-xs text-red-500">{fieldErrors.departmentId}</p>}
              </div>

              <div>
                <label htmlFor="wizard-positionId" className="mb-1 block text-xs font-semibold text-app-muted">Position *</label>
                <select
                  id="wizard-positionId"
                  required
                  value={positionId}
                  onChange={(e) => {
                    setPositionId(e.target.value);
                    clearFieldError('positionId');
                  }}
                  disabled={!departmentId}
                  className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent disabled:opacity-50 ${
                    fieldErrors.positionId ? 'border-red-500' : 'border-app-border'
                  }`}
                >
                  <option value="">Select position</option>
                  {positions.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                {fieldErrors.positionId && <p className="mt-1 text-xs text-red-500">{fieldErrors.positionId}</p>}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-app-muted">Team (Optional)</label>
                <select
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  disabled={!departmentId}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent disabled:opacity-50"
                >
                  <option value="">No team</option>
                  {departmentTeams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              {isRootPosition ? (
                <div className="rounded-xl border border-app-border bg-app-background p-3 text-xs text-app-muted">
                  This position reports directly to the Company Super Admin.
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-app-muted">Reporting Manager (Optional)</label>
                  <select
                    value={reportsTo}
                    onChange={(e) => setReportsTo(e.target.value)}
                    className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
                  >
                    <option value="">None / Independent</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.accountType === 'super-admin'
                          ? `${m.fullName} (Company Super Admin)`
                          : m.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-app-muted">Designation (Optional)</label>
                <select
                  value={designationId}
                  onChange={(e) => setDesignationId(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
                >
                  <option value="">None</option>
                  {designations.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {designation && designation.specializations.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-app-muted">Specialization (Optional)</label>
                  <select
                    value={specialization}
                    onChange={(e) => setSpecialization(e.target.value)}
                    className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
                  >
                    <option value="">Select specialization</option>
                    {designation.specializations.map((spec) => (
                      <option key={spec} value={spec}>{spec}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="wizard-joiningDate" className="mb-1 block text-xs font-semibold text-app-muted">Joining Date *</label>
                <input
                  id="wizard-joiningDate"
                  type="date"
                  required
                  value={joiningDate}
                  onChange={(e) => {
                    setJoiningDate(e.target.value);
                    clearFieldError('joiningDate');
                  }}
                  className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                    fieldErrors.joiningDate ? 'border-red-500' : 'border-app-border'
                  }`}
                />
                {fieldErrors.joiningDate && <p className="mt-1 text-xs text-red-500">{fieldErrors.joiningDate}</p>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid gap-3.5 sm:grid-cols-3">
                <div>
                  <label htmlFor="wizard-phone" className="mb-1 block text-xs font-semibold text-app-muted">Contact Phone *</label>
                  <input
                    id="wizard-phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      clearFieldError('phone');
                    }}
                    placeholder="+91 9876543210"
                    className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                      fieldErrors.phone ? 'border-red-500' : 'border-app-border'
                    }`}
                  />
                  {fieldErrors.phone && <p className="mt-1 text-xs text-red-500">{fieldErrors.phone}</p>}
                </div>
                <div>
                  <label htmlFor="wizard-dateOfBirth" className="mb-1 block text-xs font-semibold text-app-muted">Date of Birth *</label>
                  <input
                    id="wizard-dateOfBirth"
                    type="date"
                    required
                    value={dateOfBirth}
                    onChange={(e) => {
                      setDateOfBirth(e.target.value);
                      clearFieldError('dateOfBirth');
                    }}
                    className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                      fieldErrors.dateOfBirth ? 'border-red-500' : 'border-app-border'
                    }`}
                  />
                  {fieldErrors.dateOfBirth && <p className="mt-1 text-xs text-red-500">{fieldErrors.dateOfBirth}</p>}
                </div>
                <div>
                  <label htmlFor="wizard-gender" className="mb-1 block text-xs font-semibold text-app-muted">Gender *</label>
                  <select
                    id="wizard-gender"
                    required
                    value={gender}
                    onChange={(e) => {
                      setGender(e.target.value);
                      clearFieldError('gender');
                    }}
                    className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                      fieldErrors.gender ? 'border-red-500' : 'border-app-border'
                    }`}
                  >
                    <option value="">Select gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Non-Binary">Non-Binary</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                  {fieldErrors.gender && <p className="mt-1 text-xs text-red-500">{fieldErrors.gender}</p>}
                </div>
              </div>

              <div className="rounded-xl border border-app-border bg-app-background/50 p-4">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-app-muted">Address Details</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="wizard-addressLine1" className="mb-1 block text-xs font-semibold text-app-muted">Street Address Line 1 *</label>
                    <input
                      id="wizard-addressLine1"
                      type="text"
                      required
                      value={addressLine1}
                      onChange={(e) => {
                        setAddressLine1(e.target.value);
                        clearFieldError('addressLine1');
                      }}
                      placeholder="Street Address Line 1"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.addressLine1 ? 'border-red-500' : 'border-app-border'
                      }`}
                    />
                    {fieldErrors.addressLine1 && <p className="mt-1 text-xs text-red-500">{fieldErrors.addressLine1}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="wizard-addressLine2" className="mb-1 block text-xs font-semibold text-app-muted">Line 2 (Apartment, suite, etc.) (Optional)</label>
                    <input
                      id="wizard-addressLine2"
                      type="text"
                      value={addressLine2}
                      onChange={(e) => setAddressLine2(e.target.value)}
                      placeholder="Line 2 (Apartment, suite, etc.) (Optional)"
                      className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
                    />
                  </div>
                  <div>
                    <label htmlFor="wizard-city" className="mb-1 block text-xs font-semibold text-app-muted">City *</label>
                    <input
                      id="wizard-city"
                      type="text"
                      required
                      value={city}
                      onChange={(e) => {
                        setCity(e.target.value);
                        clearFieldError('city');
                      }}
                      placeholder="City"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.city ? 'border-red-500' : 'border-app-border'
                      }`}
                    />
                    {fieldErrors.city && <p className="mt-1 text-xs text-red-500">{fieldErrors.city}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="wizard-state" className="mb-1 block text-xs font-semibold text-app-muted">State *</label>
                      <input
                        id="wizard-state"
                        type="text"
                        required
                        value={state}
                        onChange={(e) => {
                          setState(e.target.value);
                          clearFieldError('state');
                        }}
                        placeholder="State"
                        className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                          fieldErrors.state ? 'border-red-500' : 'border-app-border'
                        }`}
                      />
                      {fieldErrors.state && <p className="mt-1 text-xs text-red-500">{fieldErrors.state}</p>}
                    </div>
                    <div>
                      <label htmlFor="wizard-postalCode" className="mb-1 block text-xs font-semibold text-app-muted">Postal Code *</label>
                      <input
                        id="wizard-postalCode"
                        type="text"
                        required
                        value={postalCode}
                        onChange={(e) => {
                          setPostalCode(e.target.value);
                          clearFieldError('postalCode');
                        }}
                        placeholder="Postal Code"
                        className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                          fieldErrors.postalCode ? 'border-red-500' : 'border-app-border'
                        }`}
                      />
                      {fieldErrors.postalCode && <p className="mt-1 text-xs text-red-500">{fieldErrors.postalCode}</p>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-app-border bg-app-background/50 p-4">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-app-muted">Emergency Contact</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="wizard-emergencyContactName" className="mb-1 block text-xs font-semibold text-app-muted">Contact Name *</label>
                    <input
                      id="wizard-emergencyContactName"
                      type="text"
                      required
                      value={emergencyContactName}
                      onChange={(e) => {
                        setEmergencyContactName(e.target.value);
                        clearFieldError('emergencyContactName');
                      }}
                      placeholder="Contact Name"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.emergencyContactName ? 'border-red-500' : 'border-app-border'
                      }`}
                    />
                    {fieldErrors.emergencyContactName && <p className="mt-1 text-xs text-red-500">{fieldErrors.emergencyContactName}</p>}
                  </div>
                  <div>
                    <label htmlFor="wizard-emergencyContactPhone" className="mb-1 block text-xs font-semibold text-app-muted">Contact Phone *</label>
                    <input
                      id="wizard-emergencyContactPhone"
                      type="tel"
                      required
                      value={emergencyContactPhone}
                      onChange={(e) => {
                        setEmergencyContactPhone(e.target.value);
                        clearFieldError('emergencyContactPhone');
                      }}
                      placeholder="Contact Phone"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.emergencyContactPhone ? 'border-red-500' : 'border-app-border'
                      }`}
                    />
                    {fieldErrors.emergencyContactPhone && (
                      <p className="mt-1 text-xs text-red-500">{fieldErrors.emergencyContactPhone}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="wizard-emergencyContactRelation" className="mb-1 block text-xs font-semibold text-app-muted">Relationship *</label>
                    <input
                      id="wizard-emergencyContactRelation"
                      type="text"
                      required
                      value={emergencyContactRelation}
                      onChange={(e) => {
                        setEmergencyContactRelation(e.target.value);
                        clearFieldError('emergencyContactRelation');
                      }}
                      placeholder="Relationship (e.g. Spouse)"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.emergencyContactRelation ? 'border-red-500' : 'border-app-border'
                      }`}
                    />
                    {fieldErrors.emergencyContactRelation && <p className="mt-1 text-xs text-red-500">{fieldErrors.emergencyContactRelation}</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="wizard-shiftId" className="mb-1 block text-xs font-semibold text-app-muted">Assigned Shift Schedule *</label>
                <select
                  id="wizard-shiftId"
                  value={shiftId}
                  onChange={(e) => {
                    setShiftId(e.target.value);
                    clearFieldError('shiftId');
                  }}
                  className={`w-full rounded-lg border bg-app-background px-3 py-2.5 text-sm outline-none focus:border-app-accent ${
                    fieldErrors.shiftId ? 'border-red-500' : 'border-app-border'
                  }`}
                >
                  <option value="">Select shift schedule *</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.kind === 'fixed' ? `${s.startTime ?? ''} - ${s.endTime ?? ''}` : 'Flexible'})
                    </option>
                  ))}
                </select>
                {fieldErrors.shiftId && <p className="mt-1 text-xs text-red-500">{fieldErrors.shiftId}</p>}
                <p className="mt-1 text-xs text-app-muted">
                  The employee's work calendar & attendance calculation will be bound to this shift template.
                </p>
              </div>

              <div id="wizard-skills" className="rounded-xl border border-app-border bg-app-background/50 p-4">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-muted">Skills & Competencies *</h3>
                <div className="flex gap-2">
                  <input
                    id="wizard-newSkillName"
                    type="text"
                    value={newSkillName}
                    onChange={(e) => {
                      setNewSkillName(e.target.value);
                      clearFieldError('newSkillName');
                      clearFieldError('skills');
                    }}
                    placeholder="e.g. TypeScript, Customer Service"
                    className={`flex-1 rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                      fieldErrors.newSkillName || (fieldErrors.skills && skillsList.length === 0) ? 'border-red-500' : 'border-app-border'
                    }`}
                  />
                  <select
                    value={newSkillProficiency}
                    onChange={(e) => setNewSkillProficiency(e.target.value as 'beginner' | 'intermediate' | 'advanced' | 'expert')}
                    className="w-32 rounded-lg border border-app-border bg-app-background px-2 py-2 text-xs outline-none focus:border-app-accent"
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                    <option value="expert">Expert</option>
                  </select>
                  <button
                    type="button"
                    onClick={addSkill}
                    className="rounded-lg bg-app-accent px-4 py-2 text-xs font-bold text-app-on-accent"
                  >
                    Add
                  </button>
                </div>
                {fieldErrors.newSkillName && <p className="mt-1 text-xs text-red-500">{fieldErrors.newSkillName}</p>}
                {fieldErrors.skills && <p className="mt-1 text-xs text-red-500">{fieldErrors.skills}</p>}

                {skillsList.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {skillsList.map((s, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-2.5 py-1 text-xs font-medium"
                      >
                        <span>{s.skillName}</span>
                        <span className="text-[10px] text-app-muted uppercase">({s.proficiency})</span>
                        <button
                          type="button"
                          onClick={() => removeSkill(index)}
                          className="text-app-muted hover:text-red-500 font-bold"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div id="wizard-qualifications" className="rounded-xl border border-app-border bg-app-background/50 p-4">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-app-muted">Add Qualification / Degree *</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="wizard-institution" className="mb-1 block text-xs font-semibold text-app-muted">Institution / University *</label>
                    <input
                      id="wizard-institution"
                      type="text"
                      value={institution}
                      onChange={(e) => {
                        setInstitution(e.target.value);
                        clearFieldError('qualificationDraft');
                        clearFieldError('qualifications');
                      }}
                      placeholder="Institution / University"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.qualificationDraft || (fieldErrors.qualifications && qualificationsList.length === 0)
                          ? 'border-red-500'
                          : 'border-app-border'
                      }`}
                    />
                  </div>
                  <div>
                    <label htmlFor="wizard-degree" className="mb-1 block text-xs font-semibold text-app-muted">Degree *</label>
                    <input
                      id="wizard-degree"
                      type="text"
                      value={degree}
                      onChange={(e) => {
                        setDegree(e.target.value);
                        clearFieldError('qualificationDraft');
                        clearFieldError('qualifications');
                      }}
                      placeholder="Degree (e.g. B.Tech, MBA)"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.qualificationDraft || (fieldErrors.qualifications && qualificationsList.length === 0)
                          ? 'border-red-500'
                          : 'border-app-border'
                      }`}
                    />
                  </div>
                  <div>
                    <label htmlFor="wizard-fieldOfStudy" className="mb-1 block text-xs font-semibold text-app-muted">Field of Study (Optional)</label>
                    <input
                      id="wizard-fieldOfStudy"
                      type="text"
                      value={fieldOfStudy}
                      onChange={(e) => setFieldOfStudy(e.target.value)}
                      placeholder="Field of Study (e.g. Computer Science)"
                      className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="wizard-passingYear" className="mb-1 block text-xs font-semibold text-app-muted">Passing Year (Optional)</label>
                      <input
                        id="wizard-passingYear"
                        type="number"
                        value={passingYear}
                        onChange={(e) => setPassingYear(e.target.value)}
                        placeholder="Passing Year"
                        className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
                      />
                    </div>
                    <div>
                      <label htmlFor="wizard-grade" className="mb-1 block text-xs font-semibold text-app-muted">Grade / CGPA (Optional)</label>
                      <input
                        id="wizard-grade"
                        type="text"
                        value={grade}
                        onChange={(e) => setGrade(e.target.value)}
                        placeholder="Grade / CGPA"
                        className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
                      />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addQualification}
                  className="mt-3 rounded-lg bg-app-accent px-4 py-1.5 text-xs font-bold text-app-on-accent"
                >
                  Add to List
                </button>
                {fieldErrors.qualificationDraft && <p className="mt-2 text-xs text-red-500">{fieldErrors.qualificationDraft}</p>}
                {fieldErrors.qualifications && <p className="mt-2 text-xs text-red-500">{fieldErrors.qualifications}</p>}
              </div>

              {qualificationsList.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-app-muted">Added Qualifications ({qualificationsList.length})</h4>
                  <div className="divide-y divide-app-border rounded-xl border border-app-border bg-app-surface">
                    {qualificationsList.map((q, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 text-xs">
                        <div>
                          <p className="font-bold text-app-foreground">{q.degree} — {q.institution}</p>
                          <p className="text-app-muted">{[q.fieldOfStudy, q.passingYear, q.grade].filter(Boolean).join(' · ')}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeQualification(idx)}
                          className="rounded border border-app-border px-2 py-1 text-red-500 hover:border-red-500"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-app-border bg-app-background/50 p-4">
                <h3 className="mb-1 text-sm font-bold text-app-foreground">Initial Security Credentials</h3>
                <p className="mb-4 text-xs text-app-muted">
                  These initial credentials will be securely dispatched to <span className="font-semibold text-app-foreground">{email}</span>. The employee will be prompted to reset their password upon initial login.
                </p>

                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label htmlFor="wizard-password" className="block text-xs font-semibold text-app-muted">
                        Temporary Password (min 12 chars) *
                      </label>
                      <button
                        type="button"
                        onClick={handleAutoGeneratePassword}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-app-accent hover:underline"
                      >
                        ⚡ Auto-generate
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        id="wizard-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          clearFieldError('password');
                        }}
                        placeholder="••••••••••••"
                        className={`w-full rounded-lg border bg-app-background px-3 py-2 pr-10 text-sm font-mono outline-none focus:border-app-accent ${
                          fieldErrors.password ? 'border-red-500' : 'border-app-border'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-app-muted"
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {fieldErrors.password && <p className="mt-1 text-xs text-red-500">{fieldErrors.password}</p>}
                  </div>

                  <div>
                    <label htmlFor="wizard-confirmPassword" className="mb-1 block text-xs font-semibold text-app-muted">Confirm Password *</label>
                    <input
                      id="wizard-confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        clearFieldError('confirmPassword');
                      }}
                      placeholder="••••••••••••"
                      className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent ${
                        fieldErrors.confirmPassword ? 'border-red-500' : 'border-app-border'
                      }`}
                    />
                    {fieldErrors.confirmPassword && (
                      <p className="mt-1 text-xs text-red-500">{fieldErrors.confirmPassword}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs text-emerald-800 dark:text-emerald-200">
                <p className="font-bold">Lifecycle Milestone Preview</p>
                <p className="mt-1">
                  Upon submission, the employee identity is provisioned, shift schedule assigned, and the 9-step Onboarding Workflow is automatically initialized.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="shrink-0 mt-4 flex items-center justify-between border-t border-app-border pt-4">
          <button
            type="button"
            onClick={step === 1 ? onClose : handleBack}
            className="rounded-lg border border-app-border px-4 py-2 text-sm font-semibold hover:border-app-accent"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          <div className="flex gap-2">
            {step < 5 ? (
              <button
                type="button"
                onClick={handleNext}
                className="rounded-lg bg-app-accent px-5 py-2 text-sm font-bold text-app-on-accent hover:opacity-90 transition-opacity"
              >
                Next Step →
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSubmit()}
                className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy ? 'Provisioning...' : 'Complete & Onboard Employee'}
              </button>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
