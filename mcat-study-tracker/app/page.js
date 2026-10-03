'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import config from '../data/studyConfig.json'

const EXAM_DATE = config.exam.date
const PLAN_START = '2026-10-03'

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

const addDays = (iso, amount) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + amount)
  return d.toLocaleDateString('en-CA')
}

const fmt = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

const hoursText = (minutes) => {
  const total = Math.max(0, Number(minutes) || 0)
  const h = Math.floor(total / 60)
  const m = total % 60

  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

const minutesBetween = (start, end) => {
  const a = new Date(`${start}T12:00:00`)
  const b = new Date(`${end}T12:00:00`)
  return Math.round((b - a) / 86400000)
}

const getWeekDates = (date) => {
  const d = new Date(`${date}T12:00:00`)
  const day = d.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + mondayOffset)

  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday)
    x.setDate(monday.getDate() + i)
    return x.toLocaleDateString('en-CA')
  })
}

const getPhase = (date) => {
  return (
    config.diya.phases.find(
      (phase) => date >= phase.start && date <= phase.end
    ) || null
  )
}

const getSubject = (date) => {
  const rotation = config.diya.subject_rotation
  const difference = Math.max(0, minutesBetween(PLAN_START, date))
  return rotation[difference % rotation.length]
}

const isLightDay = (date) => {
  const difference = Math.max(0, minutesBetween(PLAN_START, date))
  return difference % 7 === 6
}

const questionMinutes = (count) => {
  // Includes timed answering + substantial review allowance.
  return Math.round(count * 3.2)
}

const createDiyaTasks = (date) => {
  const phase = getPhase(date)

  if (!phase) return []

  if (phase.id === 'exam') {
    return [
      {
        type: 'Exam',
        title: 'MCAT DAY',
        resource: 'AAMC',
        minutes: 0,
        priority: 1,
        subject: 'MCAT',
        topic: 'Exam Day',
      },
    ]
  }

  const light = isLightDay(date)

  if (light) {
    return [
      {
        type: 'CARS',
        title: '2 timed CARS passages + full review',
        resource: phase.primary_resource,
        minutes: 50,
        priority: 1,
        subject: 'CARS',
        topic: 'CARS',
      },
      {
        type: 'Anki',
        title: 'Anki due cards + important missed concepts',
        resource: 'Anki',
        minutes: Math.min(phase.anki_minutes || 30, 35),
        priority: 2,
        subject: 'Mixed',
        topic: 'Retention',
      },
      {
        type: 'Review',
        title: 'Error log + weakest-topic review',
        resource: 'Error Log',
        minutes: 60,
        priority: 2,
        subject: 'Mixed',
        topic: 'Weakness Review',
      },
      {
        type: 'Overflow',
        title: 'Overflow / catch-up block if needed',
        resource: 'Study Tracker',
        minutes: 60,
        priority: 1,
        subject: 'Mixed',
        topic: 'Catch-up',
      },
    ]
  }

  const subject = getSubject(date)
  const questions = phase.question_target_min

  return [
    {
      type: 'Questions',
      title: `${questions} timed ${subject} questions`,
      resource: phase.primary_resource,
      minutes: questionMinutes(questions),
      priority: 1,
      subject,
      topic: 'Mixed Practice',
    },
    {
      type: 'CARS',
      title: `${phase.cars_passages_min} timed CARS passages + review`,
      resource: /AAMC/i.test(phase.primary_resource) ? 'AAMC' : 'CARS Practice',
      minutes: phase.cars_passages_min * 25,
      priority: 1,
      subject: 'CARS',
      topic: 'CARS',
    },
    {
      type: 'Anki',
      title: 'Anki due cards + cards from meaningful misses',
      resource: 'Anki',
      minutes: phase.anki_minutes,
      priority: 2,
      subject: 'Mixed',
      topic: 'Retention',
    },
    {
      type: 'Content',
      title: `Targeted repair from today's ${subject} weaknesses`,
      resource: 'Targeted Repair',
      minutes: phase.targeted_repair_minutes,
      priority: 2,
      subject,
      topic: 'Weakness Repair',
    },
  ]
}

export default function Home() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState('signin')

  const [msg, setMsg] = useState('')
  const [tab, setTab] = useState('Today')
  const [selected, setSelected] = useState(todayISO())

  const [tasks, setTasks] = useState([])
  const [days, setDays] = useState([])
  const [qlogs, setQlogs] = useState([])
  const [fls, setFls] = useState([])
  const [sessions, setSessions] = useState([])
  const [preferences, setPreferences] = useState(null)
  const [chapters, setChapters] = useState([])
  const [weaknesses, setWeaknesses] = useState([])
  const [partners, setPartners] = useState([])
  const [sharedSessions, setSharedSessions] = useState([])

  const [focusMin, setFocusMin] = useState(50)
  const [breakMin, setBreakMin] = useState(10)
  const [timerMode, setTimerMode] = useState('Focus')
  const [seconds, setSeconds] = useState(50 * 60)
  const [running, setRunning] = useState(false)

  const timerRef = useRef(null)

  const uid = session?.user?.id
  const today = todayISO()
  const track = preferences?.study_track || 'questions'
  const displayName =
    preferences?.display_name ||
    session?.user?.email?.split('@')[0] ||
    'Student'

  const selectedPhase = useMemo(() => getPhase(selected), [selected])

  const selectedOriginalTasks = useMemo(
    () => tasks.filter((t) => t.task_date === selected),
    [tasks, selected]
  )

  const selectedDueTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (t.current_due_date || t.task_date) === selected &&
          t.task_date === selected
      ),
    [tasks, selected]
  )

  const selectedOverflow = useMemo(
    () =>
      tasks.filter(
        (t) =>
          !t.completed &&
          (t.current_due_date || t.task_date) === selected &&
          t.task_date < selected
      ),
    [tasks, selected]
  )

  const overdueNow = useMemo(
    () =>
      tasks.filter(
        (t) =>
          !t.completed &&
          t.task_date < today &&
          t.task_type !== 'Exam'
      ),
    [tasks, today]
  )

  const overflowMinutes = useMemo(
    () =>
      overdueNow.reduce(
        (sum, task) => sum + (Number(task.estimated_minutes) || 0),
        0
      ),
    [overdueNow]
  )

  const overflowLevel =
    overflowMinutes >= config.global_rules.overflow_critical_minutes
      ? 'critical'
      : overflowMinutes >= config.global_rules.overflow_warning_minutes
      ? 'warning'
      : overflowMinutes > 0
      ? 'active'
      : 'clear'

  const selectedCompleted = selectedOriginalTasks.filter(
    (t) => t.completed
  ).length

  const selectedPct = selectedOriginalTasks.length
    ? Math.round((selectedCompleted / selectedOriginalTasks.length) * 100)
    : 0

  const selectedPlannedMinutes = [
    ...selectedDueTasks,
    ...selectedOverflow,
  ].reduce(
    (sum, task) => sum + (Number(task.estimated_minutes) || 0),
    0
  )

  const selectedActualMinutes = sessions
    .filter((s) => s.session_date === selected)
    .reduce((sum, s) => sum + (Number(s.actual_minutes) || 0), 0)

  const weekDates = useMemo(() => getWeekDates(selected), [selected])

  const weekTasks = tasks.filter((t) => weekDates.includes(t.task_date))
  const weekCompleted = weekTasks.filter((t) => t.completed).length

  const weekPlanned = weekTasks.reduce(
    (sum, t) => sum + (Number(t.estimated_minutes) || 0),
    0
  )

  const weekActual = sessions
    .filter((s) => weekDates.includes(s.session_date))
    .reduce((sum, s) => sum + (Number(s.actual_minutes) || 0), 0)

  const weekQuestions = qlogs
    .filter((q) => weekDates.includes(q.question_date))
    .reduce((sum, q) => sum + (Number(q.total_questions) || 0), 0)

  const activeChapter =
    chapters.find((c) => c.status === 'in_progress') ||
    chapters.find((c) => c.status === 'not_started') ||
    null

  const completedChapters = chapters.filter(
    (c) => c.status === 'completed'
  ).length

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      setMsg('Supabase environment variables are missing.')
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return

    initializeV2()

    const channel = supabase
      .channel(`mcat-v2-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_tasks',
          filter: `user_id=eq.${session.user.id}`,
        },
        () => loadAll()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [session])

  useEffect(() => {
    if (!running) return

    timerRef.current = setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          clearInterval(timerRef.current)
          setRunning(false)

          if (timerMode === 'Focus') {
            logSession(focusMin)
          }

          const next = timerMode === 'Focus' ? 'Break' : 'Focus'
          setTimerMode(next)

          return (next === 'Focus' ? focusMin : breakMin) * 60
        }

        return current - 1
      })
    }, 1000)

    return () => clearInterval(timerRef.current)
  }, [running, timerMode, focusMin, breakMin])

  async function initializeV2() {
    await ensurePreferences()
    await seedContentProgress()
    await seedDiyaSchedule()
    await processOverflow()
    await loadAll()
  }

  async function ensurePreferences() {
    const { data, error } = await supabase
      .from('study_preferences')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle()

    if (error) {
      setMsg(`Preferences: ${error.message}`)
      return
    }

    if (data) {
      setPreferences(data)
      return data
    }

    const { data: created, error: createError } = await supabase
      .from('study_preferences')
      .insert({
        user_id: uid,
        display_name: session.user.email?.split('@')[0] || 'Student',
        study_track: 'questions',
        target_score: 512,
        exam_date: EXAM_DATE,
        daily_question_target: 60,
        daily_cars_target: 3,
        overflow_enabled: true,
        overflow_limit_minutes: 180,
      })
      .select()
      .single()

    if (createError) {
      setMsg(`Could not create preferences: ${createError.message}`)
      return
    }

    setPreferences(created)
    return created
  }

  async function seedContentProgress() {
    const { count, error } = await supabase
      .from('content_progress')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)

    if (error) {
      setMsg(`Content setup: ${error.message}`)
      return
    }

    if (count > 0) return

    const rows = config.friend.chapters.map((chapter) => ({
      user_id: uid,
      sequence_number: chapter.sequence,
      subject: chapter.subject,
      chapter_number: chapter.chapter,
      chapter_title: chapter.title,
      status: 'not_started',
      concept_checks_completed: false,
      chapter_questions_completed: false,
      recall_completed: false,
      practice_completed: false,
    }))

    const { error: insertError } = await supabase
      .from('content_progress')
      .insert(rows)

    if (insertError) {
      setMsg(`Could not create chapter roadmap: ${insertError.message}`)
    }
  }

  async function seedDiyaSchedule() {
    // V2 only seeds the question-based schedule for dates that do not
    // already have V2-generated tasks. Existing history is preserved.

    const { data: existing, error } = await supabase
      .from('daily_tasks')
      .select('id,task_date,source_type')
      .eq('user_id', uid)
      .gte('task_date', PLAN_START)
      .lte('task_date', EXAM_DATE)

    if (error) {
      setMsg(`Schedule check: ${error.message}`)
      return
    }

    const seededDates = new Set(
      (existing || [])
        .filter((task) => task.source_type === 'v2_engine')
        .map((task) => task.task_date)
    )

    let date = PLAN_START

    while (date <= EXAM_DATE) {
      if (!seededDates.has(date)) {
        const generated = createDiyaTasks(date)

        if (generated.length) {
          let { data: studyDay, error: dayError } = await supabase
            .from('study_days')
            .select('*')
            .eq('user_id', uid)
            .eq('study_date', date)
            .maybeSingle()

          if (dayError) {
            setMsg(`Study day ${date}: ${dayError.message}`)
            return
          }

          if (!studyDay) {
            const phase = getPhase(date)

            const result = await supabase
              .from('study_days')
              .insert({
                user_id: uid,
                study_date: date,
                phase: phase?.name || 'MCAT Study',
                planned_hours:
                  generated.reduce((sum, t) => sum + t.minutes, 0) / 60,
                is_rest_day: false,
                is_full_length_day: false,
              })
              .select()
              .single()

            if (result.error) {
              setMsg(`Could not create ${date}: ${result.error.message}`)
              return
            }

            studyDay = result.data
          }

          const rows = generated.map((task, index) => ({
            user_id: uid,
            study_day_id: studyDay.id,
            task_date: date,
            current_due_date: date,
            task_type: task.type,
            title: task.title,
            description: getPhase(date)?.notes || '',
            resource: task.resource,
            estimated_minutes: task.minutes,
            sort_order: index + 1,
            completed: false,
            completed_at: null,
            carried_forward: false,
            carry_count: 0,
            priority: task.priority,
            task_status: 'scheduled',
            source_type: 'v2_engine',
            subject: task.subject,
            topic: task.topic,
          }))

          const { error: taskError } = await supabase
            .from('daily_tasks')
            .insert(rows)

          if (taskError) {
            setMsg(`Could not create tasks for ${date}: ${taskError.message}`)
            return
          }
        }
      }

      date = addDays(date, 1)
    }
  }

  async function processOverflow() {
    if (today >= EXAM_DATE) return

    const { data: overdue, error } = await supabase
      .from('daily_tasks')
      .select('*')
      .eq('user_id', uid)
      .eq('completed', false)
      .lt('task_date', today)
      .neq('task_type', 'Exam')

    if (error) {
      setMsg(`Overflow: ${error.message}`)
      return
    }

    if (!overdue?.length) return

    // Everything unfinished from a previous date becomes due today.
    // The ORIGINAL task_date is never changed.
    for (const task of overdue) {
      if (task.current_due_date !== today || !task.carried_forward) {
        const { error: updateError } = await supabase
          .from('daily_tasks')
          .update({
            current_due_date: today,
            carried_forward: true,
            carry_count: Math.max(1, Number(task.carry_count || 0) + 1),
            task_status: 'overdue',
          })
          .eq('id', task.id)

        if (updateError) {
          setMsg(`Overflow update: ${updateError.message}`)
          return
        }
      }
    }
  }

  async function loadAll() {
    if (!uid) return

    const [t, d, q, f, se, p, c, w, partnerRows, shared] =
      await Promise.all([
        supabase
          .from('daily_tasks')
          .select('*')
          .eq('user_id', uid)
          .order('task_date')
          .order('sort_order'),

        supabase
          .from('study_days')
          .select('*')
          .eq('user_id', uid)
          .order('study_date'),

        supabase
          .from('question_blocks')
          .select('*')
          .eq('user_id', uid)
          .order('question_date', { ascending: false })
          .limit(200),

        supabase
          .from('full_length_scores')
          .select('*')
          .eq('user_id', uid)
          .order('exam_date', { ascending: false }),

        supabase
          .from('study_sessions')
          .select('*')
          .eq('user_id', uid)
          .order('session_date', { ascending: false })
          .limit(500),

        supabase
          .from('study_preferences')
          .select('*')
          .eq('user_id', uid)
          .maybeSingle(),

        supabase
          .from('content_progress')
          .select('*')
          .eq('user_id', uid)
          .order('sequence_number'),

        supabase
          .from('weaknesses')
          .select('*')
          .eq('user_id', uid)
          .order('last_seen', { ascending: false }),

        supabase
          .from('study_partners')
          .select('*')
          .or(`user_id.eq.${uid},partner_user_id.eq.${uid}`),

        supabase
          .from('shared_study_sessions')
          .select('*')
          .order('session_date', { ascending: false }),
      ])

    const firstError =
      t.error ||
      d.error ||
      q.error ||
      f.error ||
      se.error ||
      p.error ||
      c.error ||
      w.error ||
      partnerRows.error ||
      shared.error

    if (firstError) {
      setMsg(firstError.message)
      return
    }

    setTasks(t.data || [])
    setDays(d.data || [])
    setQlogs(q.data || [])
    setFls(f.data || [])
    setSessions(se.data || [])
    setPreferences(p.data || null)
    setChapters(c.data || [])
    setWeaknesses(w.data || [])
    setPartners(partnerRows.data || [])
    setSharedSessions(shared.data || [])
  }

  async function toggle(task) {
    const completed = !task.completed

    const payload = {
      completed,
      completed_at: completed ? new Date().toISOString() : null,
      task_status: completed
        ? task.carried_forward
          ? 'completed_late'
          : 'completed'
        : task.task_date < today
        ? 'overdue'
        : 'scheduled',
    }

    const { error } = await supabase
      .from('daily_tasks')
      .update(payload)
      .eq('id', task.id)

    if (error) {
      setMsg(error.message)
      return
    }

    setTasks((current) =>
      current.map((x) => (x.id === task.id ? { ...x, ...payload } : x))
    )
  }

  async function setStudyTrack(newTrack) {
    const { error } = await supabase
      .from('study_preferences')
      .update({
        study_track: newTrack,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', uid)

    if (error) {
      setMsg(error.message)
      return
    }

    setPreferences((p) => ({ ...p, study_track: newTrack }))
  }

  async function updateDisplayName(e) {
    e.preventDefault()

    const fd = new FormData(e.currentTarget)
    const name = String(fd.get('name') || '').trim()

    if (!name) return

    const { error } = await supabase
      .from('study_preferences')
      .update({
        display_name: name,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', uid)

    if (error) setMsg(error.message)
    else {
      setPreferences((p) => ({ ...p, display_name: name }))
      setMsg('Profile updated.')
    }
  }

  async function startChapter(chapter) {
    // Only one chapter should be actively in progress.
    const current = chapters.find((c) => c.status === 'in_progress')

    if (current && current.id !== chapter.id) {
      setMsg(`Finish Chapter ${current.chapter_number} before starting another.`)
      return
    }

    const { error } = await supabase
      .from('content_progress')
      .update({
        status: 'in_progress',
        started_at: chapter.started_at || new Date().toISOString(),
      })
      .eq('id', chapter.id)

    if (error) setMsg(error.message)
    else loadAll()
  }

  async function toggleChapterItem(chapter, field) {
    const value = !chapter[field]

    const { error } = await supabase
      .from('content_progress')
      .update({ [field]: value })
      .eq('id', chapter.id)

    if (error) setMsg(error.message)
    else {
      setChapters((current) =>
        current.map((c) =>
          c.id === chapter.id ? { ...c, [field]: value } : c
        )
      )
    }
  }

  async function completeChapter(chapter) {
    const requirements = [
      chapter.concept_checks_completed,
      chapter.chapter_questions_completed,
      chapter.recall_completed,
      chapter.practice_completed,
    ]

    if (requirements.some((x) => !x)) {
      setMsg(
        'Complete concept checks, chapter questions, recall, and related practice first.'
      )
      return
    }

    const { error } = await supabase
      .from('content_progress')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', chapter.id)

    if (error) setMsg(error.message)
    else {
      setMsg(`Chapter ${chapter.chapter_number} completed.`)
      loadAll()
    }
  }

  async function addWeakness(e) {
    e.preventDefault()

    const fd = new FormData(e.currentTarget)

    const payload = {
      user_id: uid,
      section: fd.get('section'),
      subject: fd.get('subject'),
      topic: fd.get('topic'),
      subtopic: fd.get('subtopic') || null,
      times_missed: 1,
      times_correct: 0,
      mastery_level: 'red',
      first_seen: today,
      last_seen: today,
      retest_date: addDays(today, 3),
      notes: fd.get('notes') || null,
    }

    const { error } = await supabase.from('weaknesses').insert(payload)

    if (error) setMsg(error.message)
    else {
      e.currentTarget.reset()
      setMsg('Weakness added. Retest scheduled.')
      loadAll()
    }
  }

  async function updateMastery(item, mastery) {
    const nextRetest =
      mastery === 'green'
        ? addDays(today, 14)
        : mastery === 'yellow'
        ? addDays(today, 7)
        : addDays(today, 3)

    const { error } = await supabase
      .from('weaknesses')
      .update({
        mastery_level: mastery,
        last_seen: today,
        retest_date: nextRetest,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)

    if (error) setMsg(error.message)
    else loadAll()
  }

  async function addQuestions(e) {
    e.preventDefault()

    const fd = new FormData(e.currentTarget)
    const total = Number(fd.get('total'))
    const correct = Number(fd.get('correct'))

    const { error } = await supabase.from('question_blocks').insert({
      user_id: uid,
      question_date: fd.get('date'),
      source: fd.get('source'),
      subject: fd.get('subject'),
      total_questions: total,
      correct_questions: correct,
      timed: fd.get('timed') === 'on',
    })

    if (error) setMsg(error.message)
    else {
      e.currentTarget.reset()
      loadAll()
    }
  }

  async function addFL(e) {
    e.preventDefault()

    const fd = new FormData(e.currentTarget)

    const cp = Number(fd.get('cp'))
    const cars = Number(fd.get('cars'))
    const bb = Number(fd.get('bb'))
    const ps = Number(fd.get('ps'))

    const { error } = await supabase.from('full_length_scores').insert({
      user_id: uid,
      exam_date: fd.get('date'),
      exam_name: fd.get('name'),
      cp_score: cp,
      cars_score: cars,
      bb_score: bb,
      ps_score: ps,
      total_score: cp + cars + bb + ps,
    })

    if (error) setMsg(error.message)
    else {
      e.currentTarget.reset()
      loadAll()
    }
  }

  async function logSession(minutes) {
    if (!uid || !minutes) return

    const { error } = await supabase.from('study_sessions').insert({
      user_id: uid,
      session_date: todayISO(),
      actual_minutes: minutes,
      planned_minutes: minutes,
      session_type: 'Pomodoro',
      ended_at: new Date().toISOString(),
    })

    if (error) setMsg(error.message)
    else loadAll()
  }

  async function invitePartner(e) {
    e.preventDefault()

    const fd = new FormData(e.currentTarget)
    const inviteEmail = String(fd.get('email') || '')
      .trim()
      .toLowerCase()

    if (!inviteEmail) return

    const { error } = await supabase.from('study_partners').insert({
      user_id: uid,
      invite_email: inviteEmail,
      status: 'pending',
    })

    if (error) setMsg(error.message)
    else {
      e.currentTarget.reset()
      setMsg(
        'Study partner invitation saved. Your friend should create their own account with that email.'
      )
      loadAll()
    }
  }

  async function addSharedSession(e) {
    e.preventDefault()

    const fd = new FormData(e.currentTarget)

    const { data, error } = await supabase
      .from('shared_study_sessions')
      .insert({
        created_by: uid,
        session_date: fd.get('date'),
        title: fd.get('title'),
        session_type: fd.get('type'),
        planned_minutes: Number(fd.get('minutes')),
        completed: false,
      })
      .select()
      .single()

    if (error) {
      setMsg(error.message)
      return
    }

    await supabase.from('shared_session_members').insert({
      session_id: data.id,
      user_id: uid,
    })

    e.currentTarget.reset()
    loadAll()
  }

  async function auth(e) {
    e.preventDefault()
    setMsg('')

    const fn =
      authMode === 'signin'
        ? supabase.auth.signInWithPassword
        : supabase.auth.signUp

    const { error } = await fn({ email, password })

    if (error) setMsg(error.message)
  }

  function setTimer(kind) {
    setRunning(false)
    setTimerMode(kind)
    setSeconds((kind === 'Focus' ? focusMin : breakMin) * 60)
  }

  const testDate = new Date(`${EXAM_DATE}T12:00:00`)
  const countdown = Math.max(
    0,
    Math.ceil((testDate - new Date()) / 86400000)
  )

  if (loading) {
    return (
      <main className="auth">
        <div className="card">Loading MCAT Tracker V2…</div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="auth">
        <form className="card authCard" onSubmit={auth}>
          <div className="logo">
            <span>λ</span>
            <div>
              <b>MCAT</b>
              <small>STUDY TRACKER V2</small>
            </div>
          </div>

          <h1>{authMode === 'signin' ? 'Welcome back' : 'Create account'}</h1>
          <p>January 21, 2027</p>

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button>
            {authMode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() =>
              setAuthMode((x) => (x === 'signin' ? 'signup' : 'signin'))
            }
          >
            {authMode === 'signin'
              ? 'Need an account?'
              : 'Already have an account?'}
          </button>

          {msg && <div className="message">{msg}</div>}
        </form>
      </main>
    )
  }

  const nav = [
    'Today',
    'Calendar',
    'Questions',
    'Content',
    'Weaknesses',
    'Full Lengths',
    'Together',
    'Analytics',
    'Settings',
  ]

  return (
    <div className="shell">
      <aside className="aside">
        <div className="logo">
          <span>λ</span>
          <div>
            <b>MCAT</b>
            <small>STUDY TRACKER V2</small>
          </div>
        </div>

        <div className="profileMini">
          <small>STUDYING AS</small>
          <b>{displayName}</b>
          <span>
            {track === 'questions' ? 'Question Track' : 'Content Track'}
          </span>
        </div>

        <nav>
          {nav.map((item) => (
            <button
              key={item}
              className={tab === item ? 'active' : ''}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sideExam">
          <small>TEST DAY</small>
          <b>JAN 21</b>
          <span>2027</span>
        </div>

        <button
          className="secondary"
          onClick={() => supabase.auth.signOut()}
        >
          Sign out
        </button>
      </aside>

      <main className="content">
        <header className="header">
          <div>
            <h1>{tab}</h1>
            <p>
              {track === 'questions'
                ? selectedPhase?.name || 'MCAT preparation'
                : activeChapter
                ? `${activeChapter.subject} • Chapter ${activeChapter.chapter_number}`
                : 'Kaplan Content Review'}
            </p>
          </div>

          <div className="headerRight">
            {overflowMinutes > 0 && (
              <div className={`overflowBadge ${overflowLevel}`}>
                <small>OVERFLOW</small>
                <b>{hoursText(overflowMinutes)}</b>
              </div>
            )}

            <div className="countdown">
              <b>{countdown}</b>
              <span>days to MCAT</span>
            </div>
          </div>
        </header>

        {msg && <div className="message">{msg}</div>}

        {tab === 'Today' && (
          <>
            {overflowMinutes > 0 && (
              <section className={`card overflowPanel ${overflowLevel}`}>
                <div className="sectionTitle">
                  <div>
                    <small>ROLLED FORWARD</small>
                    <h2>Overflow</h2>
                  </div>
                  <strong>{hoursText(overflowMinutes)}</strong>
                </div>

                <p>
                  These tasks were not completed on their original dates.
                  Their missed days remain flagged.
                </p>

                <div className="taskList">
                  {overdueNow.map((task) => (
                    <div className="task overflowTask" key={task.id}>
                      <button
                        className={`taskCheck ${
                          task.completed ? 'done' : ''
                        }`}
                        onClick={() => toggle(task)}
                      >
                        {task.completed ? '✓' : ''}
                      </button>

                      <div className="taskBody">
                        <small>
                          FROM {fmt(task.task_date).toUpperCase()} •{' '}
                          {task.resource}
                        </small>
                        <b>{task.title}</b>
                        <span>
                          {hoursText(task.estimated_minutes)} • carried{' '}
                          {task.carry_count || 1}×
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {track === 'questions' ? (
              <>
                <section className="card weekSummary">
                  <div className="weekTitle">
                    <div>
                      <small>THIS WEEK</small>
                      <h2>Weekly Summary</h2>
                    </div>

                    <div className="weekStats">
                      <span>
                        <b>{weekCompleted}</b> / {weekTasks.length} tasks
                      </span>
                      <span>
                        <b>{hoursText(weekActual)}</b> focused
                      </span>
                      <span>
                        <b>{weekQuestions}</b> questions
                      </span>
                    </div>
                  </div>

                  <div className="weekDays">
                    {weekDates.map((date) => {
                      const dateTasks = tasks.filter(
                        (t) => t.task_date === date
                      )
                      const done = dateTasks.filter(
                        (t) => t.completed
                      ).length

                      const missed =
                        date < today &&
                        dateTasks.some((t) => !t.completed)

                      const late =
                        dateTasks.some(
                          (t) =>
                            t.completed &&
                            t.task_status === 'completed_late'
                        )

                      return (
                        <button
                          key={date}
                          className={[
                            selected === date ? 'selected' : '',
                            missed ? 'missed' : '',
                            late ? 'late' : '',
                            date === today ? 'current' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => setSelected(date)}
                        >
                          <small>
                            {new Date(
                              `${date}T12:00:00`
                            ).toLocaleDateString(undefined, {
                              weekday: 'short',
                            })}
                          </small>
                          <b>
                            {new Date(`${date}T12:00:00`).getDate()}
                          </b>
                          <span>
                            {dateTasks.length
                              ? `${done}/${dateTasks.length}`
                              : '—'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>

                <div className="todayHeading">
                  <div>
                    <small>{fmt(selected).toUpperCase()}</small>
                    <h2>
                      {selected === EXAM_DATE
                        ? 'MCAT DAY'
                        : isLightDay(selected)
                        ? 'Light / Consolidation Day'
                        : `${getSubject(selected)} Practice Day`}
                    </h2>

                    <p>
                      {selectedPhase?.notes ||
                        'Complete the highest-priority work first.'}
                    </p>
                  </div>

                  <div className="todayMetrics">
                    <span>
                      <small>PLANNED</small>
                      <b>{hoursText(selectedPlannedMinutes)}</b>
                    </span>

                    <span>
                      <small>FOCUSED</small>
                      <b>{hoursText(selectedActualMinutes)}</b>
                    </span>
                  </div>
                </div>

                <section className="card progressCard">
                  <div>
                    <b>Daily progress</b>
                    <span>
                      {selectedCompleted} of {selectedOriginalTasks.length}{' '}
                      complete
                    </span>
                  </div>

                  <strong>{selectedPct}%</strong>

                  <div className="progress">
                    <i style={{ width: `${selectedPct}%` }} />
                  </div>
                </section>

                <div className="dashboardGrid">
                  <section className="card">
                    <div className="sectionTitle">
                      <div>
                        <small>TODAY</small>
                        <h2>Study Checklist</h2>
                      </div>
                      <span>{selectedDueTasks.length} tasks</span>
                    </div>

                    <div className="taskList">
                      {selectedDueTasks.map((task) => (
                        <div
                          className={`task ${
                            task.completed ? 'completed' : ''
                          }`}
                          key={task.id}
                        >
                          <button
                            className={`taskCheck ${
                              task.completed ? 'done' : ''
                            }`}
                            onClick={() => toggle(task)}
                          >
                            {task.completed ? '✓' : ''}
                          </button>

                          <div className="taskBody">
                            <small>
                              {task.task_type} • {task.resource}
                            </small>
                            <b>{task.title}</b>
                            <span>
                              {hoursText(task.estimated_minutes)}
                              {task.subject
                                ? ` • ${task.subject}`
                                : ''}
                            </span>
                          </div>
                        </div>
                      ))}

                      {!selectedDueTasks.length && (
                        <p className="empty">
                          No scheduled tasks for this date.
                        </p>
                      )}
                    </div>
                  </section>

                  <Pomodoro
                    focusMin={focusMin}
                    setFocusMin={setFocusMin}
                    breakMin={breakMin}
                    setBreakMin={setBreakMin}
                    timerMode={timerMode}
                    seconds={seconds}
                    running={running}
                    setRunning={setRunning}
                    setTimer={setTimer}
                  />
                </div>
              </>
            ) : (
              <ContentDashboard
                activeChapter={activeChapter}
                completedChapters={completedChapters}
                chapters={chapters}
                startChapter={startChapter}
                toggleChapterItem={toggleChapterItem}
                completeChapter={completeChapter}
                focusMin={focusMin}
                setFocusMin={setFocusMin}
                breakMin={breakMin}
                setBreakMin={setBreakMin}
                timerMode={timerMode}
                seconds={seconds}
                running={running}
                setRunning={setRunning}
                setTimer={setTimer}
              />
            )}
          </>
        )}

        {tab === 'Calendar' && (
          <CalendarView
            tasks={tasks}
            selected={selected}
            setSelected={setSelected}
            today={today}
          />
        )}

        {tab === 'Questions' && (
          <QuestionsView
            today={today}
            qlogs={qlogs}
            addQuestions={addQuestions}
          />
        )}

        {tab === 'Content' && (
          <ContentView
            chapters={chapters}
            activeChapter={activeChapter}
            completedChapters={completedChapters}
            startChapter={startChapter}
            toggleChapterItem={toggleChapterItem}
            completeChapter={completeChapter}
          />
        )}

        {tab === 'Weaknesses' && (
          <WeaknessView
            weaknesses={weaknesses}
            addWeakness={addWeakness}
            updateMastery={updateMastery}
          />
        )}

        {tab === 'Full Lengths' && (
          <FullLengthsView
            today={today}
            fls={fls}
            addFL={addFL}
          />
        )}

        {tab === 'Together' && (
          <TogetherView
            partners={partners}
            sharedSessions={sharedSessions}
            invitePartner={invitePartner}
            addSharedSession={addSharedSession}
            today={today}
          />
        )}

        {tab === 'Analytics' && (
          <AnalyticsView
            tasks={tasks}
            qlogs={qlogs}
            fls={fls}
            sessions={sessions}
            weaknesses={weaknesses}
            chapters={chapters}
          />
        )}

        {tab === 'Settings' && (
          <section className="settingsGrid">
            <section className="card">
              <div className="sectionTitle">
                <div>
                  <small>PROFILE</small>
                  <h2>Study Profile</h2>
                </div>
              </div>

              <form className="form" onSubmit={updateDisplayName}>
                <label>
                  Display name
                  <input
                    name="name"
                    defaultValue={preferences?.display_name || ''}
                    placeholder="Your name"
                  />
                </label>

                <button>Save name</button>
              </form>
            </section>

            <section className="card">
              <div className="sectionTitle">
                <div>
                  <small>TRACK</small>
                  <h2>Study Style</h2>
                </div>
              </div>

              <p>
                Each account has its own study track. You should use the
                Question Track. Your friend should choose Content Track.
              </p>

              <div className="trackChoices">
                <button
                  className={
                    track === 'questions' ? 'activeChoice' : ''
                  }
                  onClick={() => setStudyTrack('questions')}
                >
                  <b>Question Track</b>
                  <span>
                    UWorld / Kaplan / AAMC + targeted repair
                  </span>
                </button>

                <button
                  className={track === 'content' ? 'activeChoice' : ''}
                  onClick={() => setStudyTrack('content')}
                >
                  <b>Content Track</b>
                  <span>
                    Kaplan chapters + practice + recall
                  </span>
                </button>
              </div>
            </section>

            <section className="card">
              <div className="sectionTitle">
                <div>
                  <small>EXAM</small>
                  <h2>January 21, 2027</h2>
                </div>
              </div>

              <div className="bigMetric">
                <b>{countdown}</b>
                <span>days remaining</span>
              </div>

              <p>Target score: {preferences?.target_score || 512}+</p>
            </section>
          </section>
        )}
      </main>
    </div>
  )
}

function Pomodoro({
  focusMin,
  setFocusMin,
  breakMin,
  setBreakMin,
  timerMode,
  seconds,
  running,
  setRunning,
  setTimer,
}) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <section className="card pomodoro">
      <div className="sectionTitle">
        <div>
          <small>FOCUS</small>
          <h2>Pomodoro</h2>
        </div>
        <span>{timerMode}</span>
      </div>

      <div className="timer">{mm}:{ss}</div>

      <div className="timerModes">
        <button onClick={() => setTimer('Focus')}>Focus</button>
        <button onClick={() => setTimer('Break')}>Break</button>
      </div>

      <div className="timerInputs">
        <label>
          Focus
          <input
            type="number"
            min="1"
            value={focusMin}
            onChange={(e) => {
              const n = Number(e.target.value)
              setFocusMin(n)
              if (!running && timerMode === 'Focus') {
                setTimer('Focus')
              }
            }}
          />
        </label>

        <label>
          Break
          <input
            type="number"
            min="1"
            value={breakMin}
            onChange={(e) => {
              const n = Number(e.target.value)
              setBreakMin(n)
              if (!running && timerMode === 'Break') {
                setTimer('Break')
              }
            }}
          />
        </label>
      </div>

      <button
        className="timerButton"
        onClick={() => setRunning((x) => !x)}
      >
        {running ? 'Pause' : 'Start'}
      </button>
    </section>
  )
}

function ContentDashboard({
  activeChapter,
  completedChapters,
  chapters,
  startChapter,
  toggleChapterItem,
  completeChapter,
  focusMin,
  setFocusMin,
  breakMin,
  setBreakMin,
  timerMode,
  seconds,
  running,
  setRunning,
  setTimer,
}) {
  return (
    <>
      <section className="card contentHero">
        <div>
          <small>KAPLAN CONTENT TRACK</small>
          <h2>
            {activeChapter
              ? `${activeChapter.subject} — Chapter ${activeChapter.chapter_number}`
              : 'Kaplan Content Review'}
          </h2>
          <p>
            {activeChapter?.chapter_title ||
              'All assigned chapters completed.'}
          </p>
        </div>

        <div className="chapterCounter">
          <b>{completedChapters}</b>
          <span>/ {chapters.length} chapters</span>
        </div>
      </section>

      <div className="dashboardGrid">
        <section className="card">
          <div className="sectionTitle">
            <div>
              <small>CURRENT</small>
              <h2>Chapter Checklist</h2>
            </div>
          </div>

          {activeChapter ? (
            <>
              {activeChapter.status === 'not_started' ? (
                <button
                  onClick={() => startChapter(activeChapter)}
                >
                  Start this chapter
                </button>
              ) : (
                <ChapterChecklist
                  chapter={activeChapter}
                  toggleChapterItem={toggleChapterItem}
                  completeChapter={completeChapter}
                />
              )}
            </>
          ) : (
            <p>Kaplan chapter sequence complete.</p>
          )}
        </section>

        <Pomodoro
          focusMin={focusMin}
          setFocusMin={setFocusMin}
          breakMin={breakMin}
          setBreakMin={setBreakMin}
          timerMode={timerMode}
          seconds={seconds}
          running={running}
          setRunning={setRunning}
          setTimer={setTimer}
        />
      </div>
    </>
  )
}

function ChapterChecklist({
  chapter,
  toggleChapterItem,
  completeChapter,
}) {
  const items = [
    ['concept_checks_completed', 'Read chapter + concept checks'],
    ['chapter_questions_completed', 'Chapter questions'],
    ['recall_completed', 'Closed-book recall'],
    ['practice_completed', 'Related practice questions'],
  ]

  return (
    <div className="chapterChecklist">
      {items.map(([field, label]) => (
        <button
          key={field}
          className={chapter[field] ? 'chapterDone' : ''}
          onClick={() => toggleChapterItem(chapter, field)}
        >
          <span>{chapter[field] ? '✓' : ''}</span>
          <b>{label}</b>
        </button>
      ))}

      <button
        className="completeChapter"
        onClick={() => completeChapter(chapter)}
      >
        Complete Chapter
      </button>
    </div>
  )
}

function ContentView({
  chapters,
  activeChapter,
  completedChapters,
  startChapter,
  toggleChapterItem,
  completeChapter,
}) {
  return (
    <>
      <section className="card contentHero">
        <div>
          <small>KAPLAN ROADMAP</small>
          <h2>Content Review</h2>
          <p>
            Chapters unlock sequentially so falling behind does not break
            the entire calendar.
          </p>
        </div>

        <div className="chapterCounter">
          <b>{completedChapters}</b>
          <span>/ {chapters.length}</span>
        </div>
      </section>

      {activeChapter && (
        <section className="card activeChapterCard">
          <small>CURRENT CHAPTER</small>
          <h2>
            {activeChapter.subject} • Chapter{' '}
            {activeChapter.chapter_number}
          </h2>
          <p>{activeChapter.chapter_title}</p>

          {activeChapter.status === 'not_started' ? (
            <button onClick={() => startChapter(activeChapter)}>
              Start Chapter
            </button>
          ) : (
            <ChapterChecklist
              chapter={activeChapter}
              toggleChapterItem={toggleChapterItem}
              completeChapter={completeChapter}
            />
          )}
        </section>
      )}

      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>ALL CHAPTERS</small>
            <h2>Kaplan Progress</h2>
          </div>
        </div>

        <div className="chapterList">
          {chapters.map((chapter) => (
            <div
              className={`chapterRow ${chapter.status}`}
              key={chapter.id}
            >
              <span className="chapterSequence">
                {chapter.sequence_number}
              </span>

              <div>
                <small>{chapter.subject}</small>
                <b>
                  Ch {chapter.chapter_number}: {chapter.chapter_title}
                </b>
              </div>

              <strong>
                {chapter.status === 'completed'
                  ? 'Complete'
                  : chapter.status === 'in_progress'
                  ? 'In Progress'
                  : 'Upcoming'}
              </strong>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

function CalendarView({ tasks, selected, setSelected, today }) {
  const dates = []

  let cursor = PLAN_START

  while (cursor <= EXAM_DATE) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
  }

  return (
    <section className="card">
      <div className="sectionTitle">
        <div>
          <small>OCT 3 → JAN 21</small>
          <h2>MCAT Calendar</h2>
        </div>
      </div>

      <div className="calendarGrid">
        {dates.map((date) => {
          const dt = tasks.filter((t) => t.task_date === date)
          const done = dt.filter((t) => t.completed).length
          const incomplete =
            date < today && dt.some((t) => !t.completed)

          const completedLate = dt.some(
            (t) => t.task_status === 'completed_late'
          )

          const complete =
            dt.length > 0 && done === dt.length && !completedLate

          const status = incomplete
            ? 'missed'
            : completedLate
            ? 'late'
            : complete
            ? 'complete'
            : date === today
            ? 'current'
            : 'future'

          return (
            <button
              key={date}
              className={`${status} ${
                selected === date ? 'selected' : ''
              }`}
              onClick={() => setSelected(date)}
            >
              <small>
                {new Date(`${date}T12:00:00`).toLocaleDateString(
                  undefined,
                  { weekday: 'short' }
                )}
              </small>
              <b>
                {new Date(`${date}T12:00:00`).getDate()}
              </b>
              <span>
                {dt.length ? `${done}/${dt.length}` : '—'}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function QuestionsView({ today, qlogs, addQuestions }) {
  return (
    <div className="dashboardGrid">
      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>LOG</small>
            <h2>Question Block</h2>
          </div>
        </div>

        <form className="form" onSubmit={addQuestions}>
          <label>
            Date
            <input name="date" type="date" defaultValue={today} required />
          </label>

          <label>
            Resource
            <select name="source" defaultValue="UWorld">
              <option>UWorld</option>
              <option>Kaplan</option>
              <option>AAMC</option>
              <option>Jack Westin</option>
              <option>Other</option>
            </select>
          </label>

          <label>
            Section
            <select name="subject" defaultValue="B/B">
              <option>B/B</option>
              <option>C/P</option>
              <option>P/S</option>
              <option>CARS</option>
              <option>Mixed</option>
            </select>
          </label>

          <label>
            Questions
            <input name="total" type="number" min="1" required />
          </label>

          <label>
            Correct
            <input name="correct" type="number" min="0" required />
          </label>

          <label className="checkboxLabel">
            <input name="timed" type="checkbox" />
            Timed
          </label>

          <button>Log Questions</button>
        </form>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>RECENT</small>
            <h2>Question History</h2>
          </div>
        </div>

        <div className="logList">
          {qlogs.map((q) => {
            const pct = q.total_questions
              ? Math.round(
                  (q.correct_questions / q.total_questions) * 100
                )
              : 0

            return (
              <div className="logRow" key={q.id}>
                <div>
                  <small>
                    {q.question_date} • {q.source}
                  </small>
                  <b>{q.subject}</b>
                </div>
                <strong>
                  {q.correct_questions}/{q.total_questions} • {pct}%
                </strong>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function WeaknessView({
  weaknesses,
  addWeakness,
  updateMastery,
}) {
  return (
    <div className="dashboardGrid">
      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>NEW</small>
            <h2>Add Weakness</h2>
          </div>
        </div>

        <form className="form" onSubmit={addWeakness}>
          <label>
            MCAT Section
            <select name="section" defaultValue="B/B">
              <option>B/B</option>
              <option>C/P</option>
              <option>P/S</option>
              <option>CARS</option>
            </select>
          </label>

          <label>
            Subject
            <input
              name="subject"
              placeholder="Biochemistry"
              required
            />
          </label>

          <label>
            Topic
            <input
              name="topic"
              placeholder="Amino Acids"
              required
            />
          </label>

          <label>
            Subtopic
            <input
              name="subtopic"
              placeholder="Amino acid identification"
            />
          </label>

          <label>
            Notes
            <textarea
              name="notes"
              placeholder="Missed concept checks #3 and #5..."
            />
          </label>

          <button>Add Weakness</button>
        </form>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>MASTERY</small>
            <h2>Weakness Tracker</h2>
          </div>
        </div>

        <div className="weaknessList">
          {weaknesses.map((item) => (
            <div
              className={`weakness ${item.mastery_level}`}
              key={item.id}
            >
              <div>
                <small>
                  {item.section} • {item.subject}
                </small>
                <b>
                  {item.topic}
                  {item.subtopic ? ` — ${item.subtopic}` : ''}
                </b>
                <span>
                  Retest: {item.retest_date || 'Not scheduled'}
                </span>
              </div>

              <div className="masteryButtons">
                <button onClick={() => updateMastery(item, 'red')}>
                  Red
                </button>
                <button
                  onClick={() => updateMastery(item, 'yellow')}
                >
                  Yellow
                </button>
                <button
                  onClick={() => updateMastery(item, 'green')}
                >
                  Green
                </button>
              </div>
            </div>
          ))}

          {!weaknesses.length && (
            <p className="empty">
              No weaknesses logged yet.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function FullLengthsView({ today, fls, addFL }) {
  return (
    <div className="dashboardGrid">
      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>SCORE</small>
            <h2>Log Full Length</h2>
          </div>
        </div>

        <form className="form" onSubmit={addFL}>
          <label>
            Date
            <input name="date" type="date" defaultValue={today} required />
          </label>

          <label>
            Exam
            <input
              name="name"
              placeholder="AAMC FL 1"
              required
            />
          </label>

          <label>
            C/P
            <input name="cp" type="number" min="118" max="132" required />
          </label>

          <label>
            CARS
            <input
              name="cars"
              type="number"
              min="118"
              max="132"
              required
            />
          </label>

          <label>
            B/B
            <input name="bb" type="number" min="118" max="132" required />
          </label>

          <label>
            P/S
            <input name="ps" type="number" min="118" max="132" required />
          </label>

          <button>Save Full Length</button>
        </form>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>PROGRESSION</small>
            <h2>Full Length History</h2>
          </div>
        </div>

        <div className="flList">
          {fls.map((fl) => (
            <div className="flRow" key={fl.id}>
              <div>
                <small>{fl.exam_date}</small>
                <b>{fl.exam_name}</b>
                <span>
                  C/P {fl.cp_score} • CARS {fl.cars_score} • B/B{' '}
                  {fl.bb_score} • P/S {fl.ps_score}
                </span>
              </div>

              <strong>{fl.total_score}</strong>
            </div>
          ))}

          {!fls.length && (
            <p className="empty">
              No full-length scores logged yet.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function TogetherView({
  partners,
  sharedSessions,
  invitePartner,
  addSharedSession,
  today,
}) {
  return (
    <>
      <section className="card togetherHero">
        <div>
          <small>STUDY TOGETHER</small>
          <h2>Partner Mode</h2>
          <p>
            You keep separate schedules and progress while sharing selected
            study sessions.
          </p>
        </div>
      </section>

      <div className="dashboardGrid">
        <section className="card">
          <div className="sectionTitle">
            <div>
              <small>PARTNER</small>
              <h2>Connect</h2>
            </div>
          </div>

          <form className="form" onSubmit={invitePartner}>
            <label>
              Friend's account email
              <input
                name="email"
                type="email"
                placeholder="friend@email.com"
                required
              />
            </label>

            <button>Invite Study Partner</button>
          </form>

          <div className="partnerList">
            {partners.map((partner) => (
              <div className="partnerRow" key={partner.id}>
                <div>
                  <small>STUDY PARTNER</small>
                  <b>{partner.invite_email || 'Connected account'}</b>
                </div>
                <strong>{partner.status}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="sectionTitle">
            <div>
              <small>SESSION</small>
              <h2>Plan Study Together</h2>
            </div>
          </div>

          <form className="form" onSubmit={addSharedSession}>
            <label>
              Date
              <input name="date" type="date" defaultValue={today} required />
            </label>

            <label>
              Title
              <input
                name="title"
                placeholder="CARS session"
                required
              />
            </label>

            <label>
              Type
              <select name="type" defaultValue="CARS">
                <option>CARS</option>
                <option>Full Length</option>
                <option>Full Length Review</option>
                <option>Weakness Review</option>
                <option>Study Session</option>
              </select>
            </label>

            <label>
              Minutes
              <input
                name="minutes"
                type="number"
                min="15"
                defaultValue="60"
                required
              />
            </label>

            <button>Create Session</button>
          </form>
        </section>
      </div>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>UPCOMING / RECENT</small>
            <h2>Shared Sessions</h2>
          </div>
        </div>

        <div className="logList">
          {sharedSessions.map((item) => (
            <div className="logRow" key={item.id}>
              <div>
                <small>
                  {item.session_date} • {item.session_type}
                </small>
                <b>{item.title}</b>
              </div>

              <strong>{hoursText(item.planned_minutes)}</strong>
            </div>
          ))}

          {!sharedSessions.length && (
            <p className="empty">
              No shared study sessions yet.
            </p>
          )}
        </div>
      </section>
    </>
  )
}

function AnalyticsView({
  tasks,
  qlogs,
  fls,
  sessions,
  weaknesses,
  chapters,
}) {
  const completed = tasks.filter((t) => t.completed).length
  const totalQuestions = qlogs.reduce(
    (sum, q) => sum + Number(q.total_questions || 0),
    0
  )
  const totalCorrect = qlogs.reduce(
    (sum, q) => sum + Number(q.correct_questions || 0),
    0
  )
  const accuracy = totalQuestions
    ? Math.round((totalCorrect / totalQuestions) * 100)
    : 0

  const focusMinutes = sessions.reduce(
    (sum, s) => sum + Number(s.actual_minutes || 0),
    0
  )

  const redWeaknesses = weaknesses.filter(
    (w) => w.mastery_level === 'red'
  ).length

  const completedChapters = chapters.filter(
    (c) => c.status === 'completed'
  ).length

  return (
    <>
      <div className="analyticsGrid">
        <section className="card statCard">
          <small>QUESTIONS</small>
          <b>{totalQuestions}</b>
          <span>{accuracy}% overall accuracy</span>
        </section>

        <section className="card statCard">
          <small>FOCUSED TIME</small>
          <b>{hoursText(focusMinutes)}</b>
          <span>Pomodoro study time</span>
        </section>

        <section className="card statCard">
          <small>TASKS</small>
          <b>{completed}</b>
          <span>completed</span>
        </section>

        <section className="card statCard">
          <small>RED WEAKNESSES</small>
          <b>{redWeaknesses}</b>
          <span>need repair</span>
        </section>

        <section className="card statCard">
          <small>KAPLAN</small>
          <b>
            {completedChapters}/{chapters.length}
          </b>
          <span>chapters completed</span>
        </section>

        <section className="card statCard">
          <small>FULL LENGTHS</small>
          <b>{fls.length}</b>
          <span>
            {fls[0] ? `Latest: ${fls[0].total_score}` : 'None logged'}
          </span>
        </section>
      </div>
    </>
  )
}
