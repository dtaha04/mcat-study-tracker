'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import config from '../data/studyConfig.json'

const EXAM_DATE = config.exam.date
const PLAN_START = '2026-10-03'

function localISO(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dateFromISO(iso) {
  return new Date(`${iso}T12:00:00`)
}

function addDays(iso, amount) {
  const date = dateFromISO(iso)
  date.setDate(date.getDate() + amount)
  return localISO(date)
}

function daysBetween(start, end) {
  return Math.round(
    (dateFromISO(end) - dateFromISO(start)) / 86400000
  )
}

function formatDate(iso) {
  return dateFromISO(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatMinutes(value) {
  const minutes = Math.max(0, Number(value) || 0)
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60

  if (hours && remainder) return `${hours}h ${remainder}m`
  if (hours) return `${hours}h`
  return `${remainder}m`
}

function getPhase(date) {
  return (
    config.diya.phases.find(
      (phase) => date >= phase.start && date <= phase.end
    ) || null
  )
}

function getSubject(date) {
  const rotation = config.diya.subject_rotation
  const index = Math.max(0, daysBetween(PLAN_START, date))
  return rotation[index % rotation.length]
}

function isLightDay(date) {
  const index = Math.max(0, daysBetween(PLAN_START, date))
  return index % 7 === 6
}

function getWeekDates(date) {
  const selected = dateFromISO(date)
  const weekday = selected.getDay()
  const offset = weekday === 0 ? -6 : 1 - weekday

  const monday = new Date(selected)
  monday.setDate(selected.getDate() + offset)

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + index)
    return localISO(day)
  })
}

function generateQuestionTasks(date) {
  const phase = getPhase(date)

  if (!phase) return []

  if (date === EXAM_DATE || phase.id === 'exam') {
    return [
      {
        type: 'Exam',
        title: 'MCAT DAY',
        description: 'Official MCAT exam day. No study workload.',
        resource: 'AAMC',
        minutes: 0,
        priority: 1,
        subject: 'MCAT',
        topic: 'Exam Day',
      },
    ]
  }

  if (isLightDay(date)) {
    return [
      {
        type: 'CARS',
        title: '2 timed CARS passages + full review',
        description: 'Light-day CARS practice.',
        resource: 'CARS Practice',
        minutes: 50,
        priority: 1,
        subject: 'CARS',
        topic: 'CARS',
      },
      {
        type: 'Anki',
        title: 'Anki due cards + important missed concepts',
        description: 'Keep retention moving without turning this into a heavy day.',
        resource: 'Anki',
        minutes: Math.min(Number(phase.anki_minutes) || 30, 35),
        priority: 2,
        subject: 'Mixed',
        topic: 'Retention',
      },
      {
        type: 'Review',
        title: 'Error log + weakest-topic review',
        description: 'Review recent misses and recurring reasoning problems.',
        resource: 'Error Log',
        minutes: 60,
        priority: 2,
        subject: 'Mixed',
        topic: 'Weakness Review',
      },
      {
        type: 'Catch-up',
        title: 'Catch-up / overflow block if needed',
        description: 'Use this block for important carried work. If caught up, stop early.',
        resource: 'Study Tracker',
        minutes: 60,
        priority: 1,
        subject: 'Mixed',
        topic: 'Catch-up',
      },
    ]
  }

  const subject = getSubject(date)
  const questionCount = Number(phase.question_target_min) || 50
  const carsCount = Number(phase.cars_passages_min) || 2

  // The question block includes both answering and detailed review.
  const questionBlockMinutes = Math.round(questionCount * 3.2)

  return [
    {
      type: 'Questions',
      title: `${questionCount} timed ${subject} questions + deep review`,
      description:
        'Review every incorrect answer, guessed correct answer, and uncertain correct answer.',
      resource: phase.primary_resource,
      minutes: questionBlockMinutes,
      priority: 1,
      subject,
      topic: 'Mixed Practice',
    },
    {
      type: 'CARS',
      title: `${carsCount} timed CARS passages + review`,
      description: 'Focus on reasoning and passage evidence.',
      resource:
        phase.primary_resource === 'AAMC'
          ? 'AAMC'
          : 'CARS Practice',
      minutes: carsCount * 25,
      priority: 1,
      subject: 'CARS',
      topic: 'CARS',
    },
    {
      type: 'Anki',
      title: 'Anki due cards + cards from meaningful misses',
      description:
        'Prioritize due cards and high-value cards generated from question review.',
      resource: 'Anki',
      minutes: Number(phase.anki_minutes) || 30,
      priority: 2,
      subject: 'Mixed',
      topic: 'Retention',
    },
    {
      type: 'Content',
      title: `Targeted repair from today's ${subject} weaknesses`,
      description:
        'Use content review only to repair concepts exposed by questions.',
      resource: 'Targeted Repair',
      minutes: Number(phase.targeted_repair_minutes) || 30,
      priority: 2,
      subject,
      topic: 'Weakness Repair',
    },
  ]
}

export default function Home() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [initializing, setInitializing] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState('signin')
  const [authBusy, setAuthBusy] = useState(false)

  const [message, setMessage] = useState('')
  const [tab, setTab] = useState('Today')
  const [selectedDate, setSelectedDate] = useState(localISO())

  const [tasks, setTasks] = useState([])
  const [studyDays, setStudyDays] = useState([])
  const [questionLogs, setQuestionLogs] = useState([])
  const [fullLengths, setFullLengths] = useState([])
  const [studySessions, setStudySessions] = useState([])
  const [preferences, setPreferences] = useState(null)
  const [chapters, setChapters] = useState([])
  const [weaknesses, setWeaknesses] = useState([])
  const [partners, setPartners] = useState([])
  const [sharedSessions, setSharedSessions] = useState([])

  const [focusMinutes, setFocusMinutes] = useState(50)
  const [breakMinutes, setBreakMinutes] = useState(10)
  const [timerMode, setTimerMode] = useState('Focus')
  const [timerSeconds, setTimerSeconds] = useState(50 * 60)
  const [timerRunning, setTimerRunning] = useState(false)

  const timerRef = useRef(null)

  const uid = session?.user?.id
  const today = localISO()

  const studyTrack = preferences?.study_track || 'questions'

  const displayName =
    preferences?.display_name ||
    session?.user?.email?.split('@')[0] ||
    'Student'

  const selectedPhase = useMemo(
    () => getPhase(selectedDate),
    [selectedDate]
  )

  const selectedTasks = useMemo(
    () => tasks.filter((task) => task.task_date === selectedDate),
    [tasks, selectedDate]
  )

  const selectedDueTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.task_date === selectedDate &&
          (task.current_due_date || task.task_date) === selectedDate
      ),
    [tasks, selectedDate]
  )

  const selectedOverflow = useMemo(
    () =>
      tasks.filter(
        (task) =>
          !task.completed &&
          task.task_date < selectedDate &&
          (task.current_due_date || task.task_date) === selectedDate
      ),
    [tasks, selectedDate]
  )

  const currentOverflow = useMemo(
    () =>
      tasks.filter(
        (task) =>
          !task.completed &&
          task.task_date < today &&
          task.task_type !== 'Exam'
      ),
    [tasks, today]
  )

  const overflowMinutes = useMemo(
    () =>
      currentOverflow.reduce(
        (sum, task) =>
          sum + (Number(task.estimated_minutes) || 0),
        0
      ),
    [currentOverflow]
  )

  const overflowLevel =
    overflowMinutes >= config.global_rules.overflow_critical_minutes
      ? 'critical'
      : overflowMinutes >=
        config.global_rules.overflow_warning_minutes
      ? 'warning'
      : overflowMinutes > 0
      ? 'active'
      : 'clear'

  const selectedCompleted = selectedTasks.filter(
    (task) => task.completed
  ).length

  const selectedProgress = selectedTasks.length
    ? Math.round(
        (selectedCompleted / selectedTasks.length) * 100
      )
    : 0

  const selectedPlannedMinutes = [
    ...selectedDueTasks,
    ...selectedOverflow,
  ].reduce(
    (sum, task) =>
      sum + (Number(task.estimated_minutes) || 0),
    0
  )

  const selectedFocusedMinutes = studySessions
    .filter((item) => item.session_date === selectedDate)
    .reduce(
      (sum, item) =>
        sum + (Number(item.actual_minutes) || 0),
      0
    )

  const weekDates = useMemo(
    () => getWeekDates(selectedDate),
    [selectedDate]
  )

  const weekTasks = tasks.filter((task) =>
    weekDates.includes(task.task_date)
  )

  const weekCompleted = weekTasks.filter(
    (task) => task.completed
  ).length

  const weekQuestions = questionLogs
    .filter((log) => weekDates.includes(log.question_date))
    .reduce(
      (sum, log) =>
        sum + (Number(log.total_questions) || 0),
      0
    )

  const weekFocusedMinutes = studySessions
    .filter((item) => weekDates.includes(item.session_date))
    .reduce(
      (sum, item) =>
        sum + (Number(item.actual_minutes) || 0),
      0
    )

  const activeChapter =
    chapters.find(
      (chapter) => chapter.status === 'in_progress'
    ) ||
    chapters.find(
      (chapter) => chapter.status === 'not_started'
    ) ||
    null

  const completedChapters = chapters.filter(
    (chapter) => chapter.status === 'completed'
  ).length

  const countdown = Math.max(
    0,
    Math.ceil(
      (dateFromISO(EXAM_DATE) - new Date()) / 86400000
    )
  )

  useEffect(() => {
    if (!supabase) {
      setMessage(
        'Supabase environment variables are missing.'
      )
      setLoading(false)
      return
    }

    let mounted = true

    async function getInitialSession() {
      const {
        data: { session: currentSession },
        error,
      } = await supabase.auth.getSession()

      if (!mounted) return

      if (error) {
        setMessage(error.message)
      }

      setSession(currentSession)
      setLoading(false)
    }

    getInitialSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (mounted) {
          setSession(newSession)
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!uid) return

    let cancelled = false

    async function boot() {
      setInitializing(true)

      try {
        await initializeV2()
      } catch (error) {
        console.error(error)

        if (!cancelled) {
          setMessage(
            error?.message ||
              'The tracker could not finish loading.'
          )
        }
      } finally {
        if (!cancelled) {
          setInitializing(false)
        }
      }
    }

    boot()

    const channel = supabase
      .channel(`mcat-v2-${uid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_tasks',
          filter: `user_id=eq.${uid}`,
        },
        () => {
          loadAll()
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [uid])

  useEffect(() => {
    if (!timerRunning) return

    timerRef.current = setInterval(() => {
      setTimerSeconds((current) => {
        if (current > 1) {
          return current - 1
        }

        clearInterval(timerRef.current)
        setTimerRunning(false)

        if (timerMode === 'Focus') {
          logSession(focusMinutes)
        }

        const nextMode =
          timerMode === 'Focus' ? 'Break' : 'Focus'

        setTimerMode(nextMode)

        return (
          (nextMode === 'Focus'
            ? focusMinutes
            : breakMinutes) * 60
        )
      })
    }, 1000)

    return () => {
      clearInterval(timerRef.current)
    }
  }, [
    timerRunning,
    timerMode,
    focusMinutes,
    breakMinutes,
  ])

  async function initializeV2() {
    const profile = await ensurePreferences()

    await seedContentProgress()

    // Only the question-track account needs the generated
    // question schedule.
    if (!profile || profile.study_track === 'questions') {
      await seedQuestionSchedule()
    }

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
      throw error
    }

    if (data) {
      setPreferences(data)
      return data
    }

    const { data: created, error: createError } =
      await supabase
        .from('study_preferences')
        .insert({
          user_id: uid,
          display_name:
            session?.user?.email?.split('@')[0] ||
            'Student',
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
      throw createError
    }

    setPreferences(created)
    return created
  }

  async function seedContentProgress() {
    const { count, error } = await supabase
      .from('content_progress')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('user_id', uid)

    if (error) {
      throw error
    }

    if ((count || 0) > 0) return

    const rows = config.friend.chapters.map(
      (chapter) => ({
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
      })
    )

    const { error: insertError } = await supabase
      .from('content_progress')
      .insert(rows)

    if (insertError) {
      throw insertError
    }
  }

  async function seedQuestionSchedule() {
    const { data: existing, error } = await supabase
      .from('daily_tasks')
      .select('id, task_date, source_type')
      .eq('user_id', uid)
      .gte('task_date', PLAN_START)
      .lte('task_date', EXAM_DATE)

    if (error) {
      throw error
    }

    const seededDates = new Set(
      (existing || [])
        .filter(
          (task) => task.source_type === 'v2_engine'
        )
        .map((task) => task.task_date)
    )

    let date = PLAN_START

    while (date <= EXAM_DATE) {
      if (!seededDates.has(date)) {
        const generatedTasks =
          generateQuestionTasks(date)

        if (generatedTasks.length) {
          let { data: studyDay, error: dayError } =
            await supabase
              .from('study_days')
              .select('*')
              .eq('user_id', uid)
              .eq('study_date', date)
              .maybeSingle()

          if (dayError) {
            throw dayError
          }

          if (!studyDay) {
            const phase = getPhase(date)

            const {
              data: newStudyDay,
              error: createDayError,
            } = await supabase
              .from('study_days')
              .insert({
                user_id: uid,
                study_date: date,
                phase:
                  phase?.name || 'MCAT Study',
                planned_hours:
                  generatedTasks.reduce(
                    (sum, task) =>
                      sum + task.minutes,
                    0
                  ) / 60,
                is_rest_day: false,
                is_full_length_day: false,
              })
              .select()
              .single()

            if (createDayError) {
              throw createDayError
            }

            studyDay = newStudyDay
          }

          const rows = generatedTasks.map(
            (task, index) => ({
              user_id: uid,
              study_day_id: studyDay.id,
              task_date: date,
              current_due_date: date,
              task_type: task.type,
              title: task.title,
              description: task.description,
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
            })
          )

          const { error: taskError } =
            await supabase
              .from('daily_tasks')
              .insert(rows)

          if (taskError) {
            throw taskError
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
  .eq('source_type', 'v2_engine')
  .gte('task_date', PLAN_START)
  .lt('task_date', today)
  .neq('task_type', 'Exam')
    
    if (error) {
      throw error
    }

    for (const task of overdue || []) {
      const oldDue =
        task.current_due_date || task.task_date

      const additionalCarry =
        oldDue < today ? 1 : 0

      const { error: updateError } =
        await supabase
          .from('daily_tasks')
          .update({
            current_due_date: today,
            carried_forward: true,
            carry_count: Math.max(
              1,
              Number(task.carry_count || 0) +
                additionalCarry
            ),
            task_status: 'overdue',
          })
          .eq('id', task.id)

      if (updateError) {
        throw updateError
      }
    }
  }

  async function loadAll() {
    if (!uid) return

    const [
      taskResult,
      dayResult,
      questionResult,
      flResult,
      sessionResult,
      preferenceResult,
      chapterResult,
      weaknessResult,
      partnerResult,
      sharedResult,
    ] = await Promise.all([
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
        .order('question_date', {
          ascending: false,
        })
        .limit(200),

      supabase
        .from('full_length_scores')
        .select('*')
        .eq('user_id', uid)
        .order('exam_date', {
          ascending: false,
        }),

      supabase
        .from('study_sessions')
        .select('*')
        .eq('user_id', uid)
        .order('session_date', {
          ascending: false,
        })
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
        .order('last_seen', {
          ascending: false,
        }),

      supabase
        .from('study_partners')
        .select('*')
        .or(
          `user_id.eq.${uid},partner_user_id.eq.${uid}`
        ),

      supabase
        .from('shared_study_sessions')
        .select('*')
        .order('session_date', {
          ascending: false,
        }),
    ])

    const results = [
      taskResult,
      dayResult,
      questionResult,
      flResult,
      sessionResult,
      preferenceResult,
      chapterResult,
      weaknessResult,
      partnerResult,
      sharedResult,
    ]

    const failed = results.find(
      (result) => result.error
    )

    if (failed?.error) {
      throw failed.error
    }

    setTasks(taskResult.data || [])
    setStudyDays(dayResult.data || [])
    setQuestionLogs(questionResult.data || [])
    setFullLengths(flResult.data || [])
    setStudySessions(sessionResult.data || [])
    setPreferences(preferenceResult.data || null)
    setChapters(chapterResult.data || [])
    setWeaknesses(weaknessResult.data || [])
    setPartners(partnerResult.data || [])
    setSharedSessions(sharedResult.data || [])
  }

  async function handleAuth(event) {
    event.preventDefault()

    if (!supabase) return

    setMessage('')
    setAuthBusy(true)

    try {
      if (authMode === 'signin') {
        const { data, error } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          })

        if (error) {
          setMessage(error.message)
          return
        }

        if (!data.session) {
          setMessage(
            'Sign in succeeded but no session was returned.'
          )
          return
        }

        setSession(data.session)
        setEmail('')
        setPassword('')
        return
      }

      const { data, error } =
        await supabase.auth.signUp({
          email: email.trim(),
          password,
        })

      if (error) {
        setMessage(error.message)
        return
      }

      if (data.session) {
        setSession(data.session)
        setMessage('')
      } else {
        setMessage(
          'Account created. Check your email to confirm the account, then sign in.'
        )
      }
    } catch (error) {
      console.error('Authentication error:', error)

      setMessage(
        error?.message ||
          'Authentication failed. Please try again.'
      )
    } finally {
      setAuthBusy(false)
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()

    if (error) {
      setMessage(error.message)
      return
    }

    setSession(null)
    setPreferences(null)
    setTasks([])
    setChapters([])
  }

  async function toggleTask(task) {
    const completed = !task.completed

    const payload = {
      completed,
      completed_at: completed
        ? new Date().toISOString()
        : null,
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
      .eq('user_id', uid)

    if (error) {
      setMessage(error.message)
      return
    }

    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? { ...item, ...payload }
          : item
      )
    )
  }

  async function changeStudyTrack(newTrack) {
    setMessage('')

    const { error } = await supabase
      .from('study_preferences')
      .update({
        study_track: newTrack,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', uid)

    if (error) {
      setMessage(error.message)
      return
    }

    setPreferences((current) => ({
      ...current,
      study_track: newTrack,
    }))

    if (newTrack === 'questions') {
      setMessage(
        'Question Track selected. Refresh once if the schedule does not appear immediately.'
      )
      await seedQuestionSchedule()
      await loadAll()
    } else {
      setMessage('Content Track selected.')
    }
  }

  async function updateDisplayName(event) {
    event.preventDefault()

    const form = new FormData(event.currentTarget)
    const name = String(
      form.get('name') || ''
    ).trim()

    if (!name) return

    const { error } = await supabase
      .from('study_preferences')
      .update({
        display_name: name,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', uid)

    if (error) {
      setMessage(error.message)
      return
    }

    setPreferences((current) => ({
      ...current,
      display_name: name,
    }))

    setMessage('Profile updated.')
  }

  async function startChapter(chapter) {
    const alreadyActive = chapters.find(
      (item) => item.status === 'in_progress'
    )

    if (
      alreadyActive &&
      alreadyActive.id !== chapter.id
    ) {
      setMessage(
        `Finish ${alreadyActive.subject} Chapter ${alreadyActive.chapter_number} first.`
      )
      return
    }

    const earlierIncomplete = chapters.find(
      (item) =>
        item.sequence_number <
          chapter.sequence_number &&
        item.status !== 'completed'
    )

    if (earlierIncomplete) {
      setMessage(
        `Complete sequence ${earlierIncomplete.sequence_number} first.`
      )
      return
    }

    const { error } = await supabase
      .from('content_progress')
      .update({
        status: 'in_progress',
        started_at:
          chapter.started_at ||
          new Date().toISOString(),
      })
      .eq('id', chapter.id)
      .eq('user_id', uid)

    if (error) {
      setMessage(error.message)
      return
    }

    await loadAll()
  }

  async function toggleChapterItem(
    chapter,
    field
  ) {
    const value = !chapter[field]

    const { error } = await supabase
      .from('content_progress')
      .update({
        [field]: value,
      })
      .eq('id', chapter.id)
      .eq('user_id', uid)

    if (error) {
      setMessage(error.message)
      return
    }

    setChapters((current) =>
      current.map((item) =>
        item.id === chapter.id
          ? { ...item, [field]: value }
          : item
      )
    )
  }

  async function completeChapter(chapter) {
    const ready =
      chapter.concept_checks_completed &&
      chapter.chapter_questions_completed &&
      chapter.recall_completed &&
      chapter.practice_completed

    if (!ready) {
      setMessage(
        'Complete the concept checks, chapter questions, closed-book recall, and related practice first.'
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
      .eq('user_id', uid)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(
      `${chapter.subject} Chapter ${chapter.chapter_number} completed.`
    )

    await loadAll()
  }

  async function addQuestionBlock(event) {
    event.preventDefault()

    const formElement = event.currentTarget
    const form = new FormData(formElement)

    const total = Number(form.get('total'))
    const correct = Number(form.get('correct'))

    if (correct > total) {
      setMessage(
        'Correct answers cannot be greater than total questions.'
      )
      return
    }

    const { error } = await supabase
      .from('question_blocks')
      .insert({
        user_id: uid,
        question_date: form.get('date'),
        source: form.get('source'),
        subject: form.get('subject'),
        total_questions: total,
        correct_questions: correct,
        timed: form.get('timed') === 'on',
      })

    if (error) {
      setMessage(error.message)
      return
    }

    formElement.reset()
    setMessage('Question block logged.')
    await loadAll()
  }

  async function addWeakness(event) {
    event.preventDefault()

    const formElement = event.currentTarget
    const form = new FormData(formElement)

    const { error } = await supabase
      .from('weaknesses')
      .insert({
        user_id: uid,
        section: form.get('section'),
        subject: form.get('subject'),
        topic: form.get('topic'),
        subtopic:
          form.get('subtopic') || null,
        times_missed: 1,
        times_correct: 0,
        mastery_level: 'red',
        first_seen: today,
        last_seen: today,
        retest_date: addDays(today, 3),
        notes: form.get('notes') || null,
      })

    if (error) {
      setMessage(error.message)
      return
    }

    formElement.reset()
    setMessage(
      'Weakness added. Initial retest scheduled in 3 days.'
    )
    await loadAll()
  }

  async function updateMastery(
    weakness,
    level
  ) {
    const retestDate =
      level === 'green'
        ? addDays(today, 14)
        : level === 'yellow'
        ? addDays(today, 7)
        : addDays(today, 3)

    const { error } = await supabase
      .from('weaknesses')
      .update({
        mastery_level: level,
        last_seen: today,
        retest_date: retestDate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', weakness.id)
      .eq('user_id', uid)

    if (error) {
      setMessage(error.message)
      return
    }

    await loadAll()
  }

  async function addFullLength(event) {
    event.preventDefault()

    const formElement = event.currentTarget
    const form = new FormData(formElement)

    const cp = Number(form.get('cp'))
    const cars = Number(form.get('cars'))
    const bb = Number(form.get('bb'))
    const ps = Number(form.get('ps'))

    const { error } = await supabase
      .from('full_length_scores')
      .insert({
        user_id: uid,
        exam_date: form.get('date'),
        exam_name: form.get('name'),
        cp_score: cp,
        cars_score: cars,
        bb_score: bb,
        ps_score: ps,
        total_score: cp + cars + bb + ps,
      })

    if (error) {
      setMessage(error.message)
      return
    }

    formElement.reset()
    setMessage('Full-length score saved.')
    await loadAll()
  }

  async function logSession(minutes) {
    if (!uid || !minutes) return

    const { error } = await supabase
      .from('study_sessions')
      .insert({
        user_id: uid,
        session_date: localISO(),
        actual_minutes: minutes,
        planned_minutes: minutes,
        session_type: 'Pomodoro',
        ended_at: new Date().toISOString(),
      })

    if (error) {
      setMessage(error.message)
      return
    }

    await loadAll()
  }

  async function invitePartner(event) {
    event.preventDefault()

    const formElement = event.currentTarget
    const form = new FormData(formElement)

    const inviteEmail = String(
      form.get('email') || ''
    )
      .trim()
      .toLowerCase()

    if (!inviteEmail) return

    const { error } = await supabase
      .from('study_partners')
      .insert({
        user_id: uid,
        invite_email: inviteEmail,
        status: 'pending',
      })

    if (error) {
      setMessage(error.message)
      return
    }

    formElement.reset()

    setMessage(
      'Partner invitation saved. Your friend should create their own tracker account with that email.'
    )

    await loadAll()
  }

  async function addSharedSession(event) {
    event.preventDefault()

    const formElement = event.currentTarget
    const form = new FormData(formElement)

    const { data, error } = await supabase
      .from('shared_study_sessions')
      .insert({
        created_by: uid,
        session_date: form.get('date'),
        title: form.get('title'),
        session_type: form.get('type'),
        planned_minutes: Number(
          form.get('minutes')
        ),
        completed: false,
      })
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    const { error: memberError } =
      await supabase
        .from('shared_session_members')
        .insert({
          session_id: data.id,
          user_id: uid,
        })

    if (memberError) {
      setMessage(memberError.message)
      return
    }

    formElement.reset()
    setMessage('Shared study session created.')
    await loadAll()
  }

  function resetTimer(mode) {
    setTimerRunning(false)
    setTimerMode(mode)
    setTimerSeconds(
      (mode === 'Focus'
        ? focusMinutes
        : breakMinutes) * 60
    )
  }

  if (loading) {
    return (
      <main className="auth">
        <div className="card">
          Loading MCAT Study Tracker…
        </div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="auth">
        <form
          className="card authCard"
          onSubmit={handleAuth}
        >
          <div className="logo">
            <span>λ</span>

            <div>
              <b>MCAT</b>
              <small>STUDY TRACKER V2</small>
            </div>
          </div>

          <h1>
            {authMode === 'signin'
              ? 'Welcome back'
              : 'Create account'}
          </h1>

          <p>January 21, 2027</p>

          <input
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            required
          />

          <input
            type="password"
            placeholder="Password"
            autoComplete={
              authMode === 'signin'
                ? 'current-password'
                : 'new-password'
            }
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            required
          />

          <button
            type="submit"
            disabled={authBusy}
          >
            {authBusy
              ? 'Please wait…'
              : authMode === 'signin'
              ? 'Sign in'
              : 'Create account'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => {
              setMessage('')
              setAuthMode((current) =>
                current === 'signin'
                  ? 'signup'
                  : 'signin'
              )
            }}
          >
            {authMode === 'signin'
              ? 'Need an account? Create one'
              : 'Already have an account? Sign in'}
          </button>

          {message && (
            <div className="message">
              {message}
            </div>
          )}
        </form>
      </main>
    )
  }

  const navItems = [
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
            {studyTrack === 'questions'
              ? 'Question Track'
              : 'Content Track'}
          </span>
        </div>

        <nav>
          {navItems.map((item) => (
            <button
              key={item}
              className={
                tab === item ? 'active' : ''
              }
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
          onClick={signOut}
        >
          Sign out
        </button>
      </aside>

      <main className="content">
        <header className="header">
          <div>
            <h1>{tab}</h1>

            <p>
              {studyTrack === 'questions'
                ? selectedPhase?.name ||
                  'MCAT preparation'
                : activeChapter
                ? `${activeChapter.subject} • Chapter ${activeChapter.chapter_number}`
                : 'Kaplan Content Review'}
            </p>
          </div>

          <div className="headerRight">
            {overflowMinutes > 0 && (
              <div
                className={`overflowBadge ${overflowLevel}`}
              >
                <small>OVERFLOW</small>
                <b>
                  {formatMinutes(
                    overflowMinutes
                  )}
                </b>
              </div>
            )}

            <div className="countdown">
              <b>{countdown}</b>
              <span>days to MCAT</span>
            </div>
          </div>
        </header>

        {initializing && (
          <div className="message">
            Preparing your V2 study plan…
          </div>
        )}

        {message && (
          <div className="message">
            {message}
          </div>
        )}

        {tab === 'Today' &&
          studyTrack === 'questions' && (
            <QuestionDashboard
              today={today}
              selectedDate={selectedDate}
              setSelectedDate={
                setSelectedDate
              }
              selectedPhase={
                selectedPhase
              }
              selectedTasks={
                selectedTasks
              }
              selectedDueTasks={
                selectedDueTasks
              }
              selectedOverflow={
                selectedOverflow
              }
              currentOverflow={
                currentOverflow
              }
              overflowMinutes={
                overflowMinutes
              }
              overflowLevel={
                overflowLevel
              }
              selectedCompleted={
                selectedCompleted
              }
              selectedProgress={
                selectedProgress
              }
              selectedPlannedMinutes={
                selectedPlannedMinutes
              }
              selectedFocusedMinutes={
                selectedFocusedMinutes
              }
              weekDates={weekDates}
              weekTasks={weekTasks}
              weekCompleted={
                weekCompleted
              }
              weekQuestions={
                weekQuestions
              }
              weekFocusedMinutes={
                weekFocusedMinutes
              }
              tasks={tasks}
              toggleTask={toggleTask}
              focusMinutes={
                focusMinutes
              }
              setFocusMinutes={
                setFocusMinutes
              }
              breakMinutes={
                breakMinutes
              }
              setBreakMinutes={
                setBreakMinutes
              }
              timerMode={timerMode}
              timerSeconds={
                timerSeconds
              }
              timerRunning={
                timerRunning
              }
              setTimerRunning={
                setTimerRunning
              }
              resetTimer={resetTimer}
            />
          )}

        {tab === 'Today' &&
          studyTrack === 'content' && (
            <ContentDashboard
              activeChapter={
                activeChapter
              }
              completedChapters={
                completedChapters
              }
              chapters={chapters}
              startChapter={
                startChapter
              }
              toggleChapterItem={
                toggleChapterItem
              }
              completeChapter={
                completeChapter
              }
              focusMinutes={
                focusMinutes
              }
              setFocusMinutes={
                setFocusMinutes
              }
              breakMinutes={
                breakMinutes
              }
              setBreakMinutes={
                setBreakMinutes
              }
              timerMode={timerMode}
              timerSeconds={
                timerSeconds
              }
              timerRunning={
                timerRunning
              }
              setTimerRunning={
                setTimerRunning
              }
              resetTimer={resetTimer}
            />
          )}

        {tab === 'Calendar' && (
          <CalendarView
            tasks={tasks}
            today={today}
            selectedDate={selectedDate}
            setSelectedDate={(date) => {
              setSelectedDate(date)
              setTab('Today')
            }}
          />
        )}

        {tab === 'Questions' && (
          <QuestionsView
            today={today}
            questionLogs={
              questionLogs
            }
            addQuestionBlock={
              addQuestionBlock
            }
          />
        )}

        {tab === 'Content' && (
          <ContentView
            chapters={chapters}
            activeChapter={
              activeChapter
            }
            completedChapters={
              completedChapters
            }
            startChapter={
              startChapter
            }
            toggleChapterItem={
              toggleChapterItem
            }
            completeChapter={
              completeChapter
            }
          />
        )}

        {tab === 'Weaknesses' && (
          <WeaknessView
            weaknesses={weaknesses}
            addWeakness={
              addWeakness
            }
            updateMastery={
              updateMastery
            }
          />
        )}

        {tab === 'Full Lengths' && (
          <FullLengthView
            today={today}
            fullLengths={
              fullLengths
            }
            addFullLength={
              addFullLength
            }
          />
        )}

        {tab === 'Together' && (
          <TogetherView
            today={today}
            partners={partners}
            sharedSessions={
              sharedSessions
            }
            invitePartner={
              invitePartner
            }
            addSharedSession={
              addSharedSession
            }
          />
        )}

        {tab === 'Analytics' && (
          <AnalyticsView
            tasks={tasks}
            questionLogs={
              questionLogs
            }
            fullLengths={
              fullLengths
            }
            studySessions={
              studySessions
            }
            weaknesses={
              weaknesses
            }
            chapters={chapters}
          />
        )}

        {tab === 'Settings' && (
          <SettingsView
            preferences={
              preferences
            }
            studyTrack={
              studyTrack
            }
            countdown={countdown}
            updateDisplayName={
              updateDisplayName
            }
            changeStudyTrack={
              changeStudyTrack
            }
          />
        )}
      </main>
    </div>
  )
}

function QuestionDashboard(props) {
  const {
    today,
    selectedDate,
    setSelectedDate,
    selectedPhase,
    selectedTasks,
    selectedDueTasks,
    selectedOverflow,
    currentOverflow,
    overflowMinutes,
    overflowLevel,
    selectedCompleted,
    selectedProgress,
    selectedPlannedMinutes,
    selectedFocusedMinutes,
    weekDates,
    weekTasks,
    weekCompleted,
    weekQuestions,
    weekFocusedMinutes,
    tasks,
    toggleTask,
  } = props

  return (
    <>
      {overflowMinutes > 0 && (
        <section
          className={`card overflowPanel ${overflowLevel}`}
        >
          <div className="sectionTitle">
            <div>
              <small>
                ROLLED FORWARD
              </small>
              <h2>Overflow</h2>
            </div>

            <strong>
              {formatMinutes(
                overflowMinutes
              )}
            </strong>
          </div>

          <p>
            These tasks were missed on
            their original dates. The
            original days remain flagged.
          </p>

          <div className="taskList">
            {currentOverflow.map(
              (task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  toggleTask={
                    toggleTask
                  }
                  overflow
                />
              )
            )}
          </div>
        </section>
      )}

      <section className="card weekSummary">
        <div className="weekTitle">
          <div>
            <small>THIS WEEK</small>
            <h2>Weekly Summary</h2>
          </div>

          <div className="weekStats">
            <span>
              <b>{weekCompleted}</b> /{' '}
              {weekTasks.length} tasks
            </span>

            <span>
              <b>
                {formatMinutes(
                  weekFocusedMinutes
                )}
              </b>{' '}
              focused
            </span>

            <span>
              <b>{weekQuestions}</b>{' '}
              questions
            </span>
          </div>
        </div>

        <div className="weekDays">
          {weekDates.map((date) => {
            const dateTasks =
              tasks.filter(
                (task) =>
                  task.task_date === date
              )

            const done =
              dateTasks.filter(
                (task) =>
                  task.completed
              ).length

            const missed =
              date < today &&
              dateTasks.some(
                (task) =>
                  !task.completed
              )

            const late =
              dateTasks.some(
                (task) =>
                  task.task_status ===
                  'completed_late'
              )

            return (
              <button
                key={date}
                className={[
                  selectedDate === date
                    ? 'selected'
                    : '',
                  missed
                    ? 'missed'
                    : '',
                  late ? 'late' : '',
                  date === today
                    ? 'current'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() =>
                  setSelectedDate(date)
                }
              >
                <small>
                  {dateFromISO(
                    date
                  ).toLocaleDateString(
                    undefined,
                    {
                      weekday: 'short',
                    }
                  )}
                </small>

                <b>
                  {dateFromISO(
                    date
                  ).getDate()}
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
          <small>
            {formatDate(
              selectedDate
            ).toUpperCase()}
          </small>

          <h2>
            {selectedDate ===
            EXAM_DATE
              ? 'MCAT DAY'
              : isLightDay(
                  selectedDate
                )
              ? 'Light / Consolidation Day'
              : `${getSubject(
                  selectedDate
                )} Practice Day`}
          </h2>

          <p>
            {selectedPhase?.notes ||
              'Complete the highest-priority work first.'}
          </p>
        </div>

        <div className="todayMetrics">
          <span>
            <small>PLANNED</small>
            <b>
              {formatMinutes(
                selectedPlannedMinutes
              )}
            </b>
          </span>

          <span>
            <small>FOCUSED</small>
            <b>
              {formatMinutes(
                selectedFocusedMinutes
              )}
            </b>
          </span>
        </div>
      </div>

      {selectedOverflow.length >
        0 && (
        <section className="card">
          <div className="sectionTitle">
            <div>
              <small>
                OVERFLOW FOR THIS DAY
              </small>
              <h2>
                Carried Work
              </h2>
            </div>
          </div>

          <div className="taskList">
            {selectedOverflow.map(
              (task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  toggleTask={
                    toggleTask
                  }
                  overflow
                />
              )
            )}
          </div>
        </section>
      )}

      <section className="card progressCard">
        <div>
          <b>Daily progress</b>
          <span>
            {selectedCompleted} of{' '}
            {selectedTasks.length}{' '}
            complete
          </span>
        </div>

        <strong>
          {selectedProgress}%
        </strong>

        <div className="progress">
          <i
            style={{
              width: `${selectedProgress}%`,
            }}
          />
        </div>
      </section>

      <div className="dashboardGrid">
        <section className="card">
          <div className="sectionTitle">
            <div>
              <small>TODAY</small>
              <h2>
                Study Checklist
              </h2>
            </div>

            <span>
              {selectedDueTasks.length}{' '}
              tasks
            </span>
          </div>

          <div className="taskList">
            {selectedDueTasks.map(
              (task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  toggleTask={
                    toggleTask
                  }
                />
              )
            )}

            {!selectedDueTasks.length && (
              <p className="empty">
                No scheduled tasks for
                this date.
              </p>
            )}
          </div>
        </section>

        <Pomodoro {...props} />
      </div>
    </>
  )
}

function TaskRow({
  task,
  toggleTask,
  overflow = false,
}) {
  return (
    <div
      className={[
        'task',
        task.completed
          ? 'completed'
          : '',
        overflow
          ? 'overflowTask'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        className={`taskCheck ${
          task.completed
            ? 'done'
            : ''
        }`}
        onClick={() =>
          toggleTask(task)
        }
      >
        {task.completed ? '✓' : ''}
      </button>

      <div className="taskBody">
        <small>
          {overflow
            ? `FROM ${formatDate(
                task.task_date
              ).toUpperCase()} • `
            : ''}
          {task.task_type} •{' '}
          {task.resource}
        </small>

        <b>{task.title}</b>

        <span>
          {formatMinutes(
            task.estimated_minutes
          )}

          {task.subject
            ? ` • ${task.subject}`
            : ''}

          {overflow
            ? ` • carried ${
                task.carry_count || 1
              }×`
            : ''}
        </span>
      </div>
    </div>
  )
}

function Pomodoro({
  focusMinutes,
  setFocusMinutes,
  breakMinutes,
  setBreakMinutes,
  timerMode,
  timerSeconds,
  timerRunning,
  setTimerRunning,
  resetTimer,
}) {
  const minutes = String(
    Math.floor(timerSeconds / 60)
  ).padStart(2, '0')

  const seconds = String(
    timerSeconds % 60
  ).padStart(2, '0')

  return (
    <section className="card pomodoro">
      <div className="sectionTitle">
        <div>
          <small>FOCUS</small>
          <h2>Pomodoro</h2>
        </div>

        <span>{timerMode}</span>
      </div>

      <div className="timer">
        {minutes}:{seconds}
      </div>

      <div className="timerModes">
        <button
          onClick={() =>
            resetTimer('Focus')
          }
        >
          Focus
        </button>

        <button
          onClick={() =>
            resetTimer('Break')
          }
        >
          Break
        </button>
      </div>

      <div className="timerInputs">
        <label>
          Focus
          <input
            type="number"
            min="1"
            value={focusMinutes}
            onChange={(event) =>
              setFocusMinutes(
                Math.max(
                  1,
                  Number(
                    event.target.value
                  ) || 1
                )
              )
            }
          />
        </label>

        <label>
          Break
          <input
            type="number"
            min="1"
            value={breakMinutes}
            onChange={(event) =>
              setBreakMinutes(
                Math.max(
                  1,
                  Number(
                    event.target.value
                  ) || 1
                )
              )
            }
          />
        </label>
      </div>

      <button
        className="timerButton"
        onClick={() =>
          setTimerRunning(
            (current) => !current
          )
        }
      >
        {timerRunning
          ? 'Pause'
          : 'Start'}
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
  ...timerProps
}) {
  return (
    <>
      <section className="card contentHero">
        <div>
          <small>
            KAPLAN CONTENT TRACK
          </small>

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
          <b>
            {completedChapters}
          </b>
          <span>
            / {chapters.length}{' '}
            chapters
          </span>
        </div>
      </section>

      <div className="dashboardGrid">
        <section className="card">
          <div className="sectionTitle">
            <div>
              <small>CURRENT</small>
              <h2>
                Chapter Checklist
              </h2>
            </div>
          </div>

          {!activeChapter && (
            <p>
              Kaplan chapter sequence
              complete.
            </p>
          )}

          {activeChapter?.status ===
            'not_started' && (
            <button
              onClick={() =>
                startChapter(
                  activeChapter
                )
              }
            >
              Start this chapter
            </button>
          )}

          {activeChapter?.status ===
            'in_progress' && (
            <ChapterChecklist
              chapter={
                activeChapter
              }
              toggleChapterItem={
                toggleChapterItem
              }
              completeChapter={
                completeChapter
              }
            />
          )}
        </section>

        <Pomodoro
          {...timerProps}
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
  const checklist = [
    [
      'concept_checks_completed',
      'Read chapter + concept checks',
    ],
    [
      'chapter_questions_completed',
      'Chapter questions',
    ],
    [
      'recall_completed',
      'Closed-book recall',
    ],
    [
      'practice_completed',
      'Related practice questions',
    ],
  ]

  return (
    <div className="chapterChecklist">
      {checklist.map(
        ([field, label]) => (
          <button
            key={field}
            className={
              chapter[field]
                ? 'chapterDone'
                : ''
            }
            onClick={() =>
              toggleChapterItem(
                chapter,
                field
              )
            }
          >
            <span>
              {chapter[field]
                ? '✓'
                : ''}
            </span>
            <b>{label}</b>
          </button>
        )
      )}

      <button
        className="completeChapter"
        onClick={() =>
          completeChapter(chapter)
        }
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
          <small>
            KAPLAN ROADMAP
          </small>
          <h2>Content Review</h2>
          <p>
            Chapters progress
            sequentially, so a missed
            chapter does not break the
            calendar.
          </p>
        </div>

        <div className="chapterCounter">
          <b>
            {completedChapters}
          </b>
          <span>
            / {chapters.length}
          </span>
        </div>
      </section>

      {activeChapter && (
        <section className="card activeChapterCard">
          <small>
            CURRENT CHAPTER
          </small>

          <h2>
            {activeChapter.subject} •
            Chapter{' '}
            {
              activeChapter.chapter_number
            }
          </h2>

          <p>
            {
              activeChapter.chapter_title
            }
          </p>

          {activeChapter.status ===
          'not_started' ? (
            <button
              onClick={() =>
                startChapter(
                  activeChapter
                )
              }
            >
              Start Chapter
            </button>
          ) : (
            <ChapterChecklist
              chapter={
                activeChapter
              }
              toggleChapterItem={
                toggleChapterItem
              }
              completeChapter={
                completeChapter
              }
            />
          )}
        </section>
      )}

      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>
              ALL CHAPTERS
            </small>
            <h2>
              Kaplan Progress
            </h2>
          </div>
        </div>

        <div className="chapterList">
          {chapters.map(
            (chapter) => (
              <div
                className={`chapterRow ${chapter.status}`}
                key={chapter.id}
              >
                <span className="chapterSequence">
                  {
                    chapter.sequence_number
                  }
                </span>

                <div>
                  <small>
                    {chapter.subject}
                  </small>

                  <b>
                    Ch{' '}
                    {
                      chapter.chapter_number
                    }
                    :{' '}
                    {
                      chapter.chapter_title
                    }
                  </b>
                </div>

                <strong>
                  {chapter.status ===
                  'completed'
                    ? 'Complete'
                    : chapter.status ===
                      'in_progress'
                    ? 'In Progress'
                    : 'Upcoming'}
                </strong>
              </div>
            )
          )}
        </div>
      </section>
    </>
  )
}

function CalendarView({
  tasks,
  today,
  selectedDate,
  setSelectedDate,
}) {
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
          <small>
            OCT 3 → JAN 21
          </small>
          <h2>MCAT Calendar</h2>
        </div>
      </div>

      <div className="calendarGrid">
        {dates.map((date) => {
          const dateTasks =
            tasks.filter(
              (task) =>
                task.task_date === date
            )

          const completed =
            dateTasks.filter(
              (task) =>
                task.completed
            ).length

          const incomplete =
            date < today &&
            dateTasks.some(
              (task) =>
                !task.completed
            )

          const late =
            dateTasks.some(
              (task) =>
                task.task_status ===
                'completed_late'
            )

          const complete =
            dateTasks.length > 0 &&
            completed ===
              dateTasks.length &&
            !late

          const status = incomplete
            ? 'missed'
            : late
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
                selectedDate === date
                  ? 'selected'
                  : ''
              }`}
              onClick={() =>
                setSelectedDate(date)
              }
            >
              <small>
                {dateFromISO(
                  date
                ).toLocaleDateString(
                  undefined,
                  {
                    weekday: 'short',
                  }
                )}
              </small>

              <b>
                {dateFromISO(
                  date
                ).getDate()}
              </b>

              <span>
                {dateTasks.length
                  ? `${completed}/${dateTasks.length}`
                  : '—'}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function QuestionsView({
  today,
  questionLogs,
  addQuestionBlock,
}) {
  return (
    <div className="dashboardGrid">
      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>LOG</small>
            <h2>
              Question Block
            </h2>
          </div>
        </div>

        <form
          className="form"
          onSubmit={
            addQuestionBlock
          }
        >
          <label>
            Date
            <input
              name="date"
              type="date"
              defaultValue={today}
              required
            />
          </label>

          <label>
            Resource
            <select
              name="source"
              defaultValue="UWorld"
            >
              <option>UWorld</option>
              <option>Kaplan</option>
              <option>AAMC</option>
              <option>
                Jack Westin
              </option>
              <option>Other</option>
            </select>
          </label>

          <label>
            Section
            <select
              name="subject"
              defaultValue="B/B"
            >
              <option>B/B</option>
              <option>C/P</option>
              <option>P/S</option>
              <option>CARS</option>
              <option>Mixed</option>
            </select>
          </label>

          <label>
            Questions
            <input
              name="total"
              type="number"
              min="1"
              required
            />
          </label>

          <label>
            Correct
            <input
              name="correct"
              type="number"
              min="0"
              required
            />
          </label>

          <label className="checkboxLabel">
            <input
              name="timed"
              type="checkbox"
            />
            Timed
          </label>

          <button type="submit">
            Log Questions
          </button>
        </form>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>RECENT</small>
            <h2>
              Question History
            </h2>
          </div>
        </div>

        <div className="logList">
          {questionLogs.map(
            (log) => {
              const accuracy =
                log.total_questions
                  ? Math.round(
                      (log.correct_questions /
                        log.total_questions) *
                        100
                    )
                  : 0

              return (
                <div
                  className="logRow"
                  key={log.id}
                >
                  <div>
                    <small>
                      {
                        log.question_date
                      }{' '}
                      • {log.source}
                    </small>
                    <b>
                      {log.subject}
                    </b>
                  </div>

                  <strong>
                    {
                      log.correct_questions
                    }
                    /
                    {
                      log.total_questions
                    }{' '}
                    • {accuracy}%
                  </strong>
                </div>
              )
            }
          )}

          {!questionLogs.length && (
            <p className="empty">
              No question blocks
              logged yet.
            </p>
          )}
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

        <form
          className="form"
          onSubmit={addWeakness}
        >
          <label>
            MCAT Section
            <select
              name="section"
              defaultValue="B/B"
            >
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
              placeholder="What went wrong?"
            />
          </label>

          <button type="submit">
            Add Weakness
          </button>
        </form>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>MASTERY</small>
            <h2>
              Weakness Tracker
            </h2>
          </div>
        </div>

        <div className="weaknessList">
          {weaknesses.map(
            (weakness) => (
              <div
                className={`weakness ${weakness.mastery_level}`}
                key={weakness.id}
              >
                <div>
                  <small>
                    {
                      weakness.section
                    }{' '}
                    •{' '}
                    {
                      weakness.subject
                    }
                  </small>

                  <b>
                    {weakness.topic}
                    {weakness.subtopic
                      ? ` — ${weakness.subtopic}`
                      : ''}
                  </b>

                  <span>
                    Retest:{' '}
                    {weakness.retest_date ||
                      'Not scheduled'}
                  </span>
                </div>

                <div className="masteryButtons">
                  <button
                    onClick={() =>
                      updateMastery(
                        weakness,
                        'red'
                      )
                    }
                  >
                    Red
                  </button>

                  <button
                    onClick={() =>
                      updateMastery(
                        weakness,
                        'yellow'
                      )
                    }
                  >
                    Yellow
                  </button>

                  <button
                    onClick={() =>
                      updateMastery(
                        weakness,
                        'green'
                      )
                    }
                  >
                    Green
                  </button>
                </div>
              </div>
            )
          )}

          {!weaknesses.length && (
            <p className="empty">
              No weaknesses logged
              yet.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function FullLengthView({
  today,
  fullLengths,
  addFullLength,
}) {
  return (
    <div className="dashboardGrid">
      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>SCORE</small>
            <h2>
              Log Full Length
            </h2>
          </div>
        </div>

        <form
          className="form"
          onSubmit={addFullLength}
        >
          <label>
            Date
            <input
              name="date"
              type="date"
              defaultValue={today}
              required
            />
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
            <input
              name="cp"
              type="number"
              min="118"
              max="132"
              required
            />
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
            <input
              name="bb"
              type="number"
              min="118"
              max="132"
              required
            />
          </label>

          <label>
            P/S
            <input
              name="ps"
              type="number"
              min="118"
              max="132"
              required
            />
          </label>

          <button type="submit">
            Save Full Length
          </button>
        </form>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>
              PROGRESSION
            </small>
            <h2>
              Full Length History
            </h2>
          </div>
        </div>

        <div className="flList">
          {fullLengths.map(
            (exam) => (
              <div
                className="flRow"
                key={exam.id}
              >
                <div>
                  <small>
                    {exam.exam_date}
                  </small>
                  <b>
                    {exam.exam_name}
                  </b>
                  <span>
                    C/P{' '}
                    {exam.cp_score} •
                    CARS{' '}
                    {exam.cars_score} •
                    B/B{' '}
                    {exam.bb_score} •
                    P/S{' '}
                    {exam.ps_score}
                  </span>
                </div>

                <strong>
                  {
                    exam.total_score
                  }
                </strong>
              </div>
            )
          )}

          {!fullLengths.length && (
            <p className="empty">
              No full-length scores
              logged yet.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function TogetherView({
  today,
  partners,
  sharedSessions,
  invitePartner,
  addSharedSession,
}) {
  return (
    <>
      <section className="card togetherHero">
        <div>
          <small>
            STUDY TOGETHER
          </small>
          <h2>Partner Mode</h2>
          <p>
            Keep separate schedules
            and progress while sharing
            selected study sessions.
          </p>
        </div>
      </section>

      <div className="dashboardGrid">
        <section className="card">
          <div className="sectionTitle">
            <div>
              <small>
                PARTNER
              </small>
              <h2>Connect</h2>
            </div>
          </div>

          <form
            className="form"
            onSubmit={
              invitePartner
            }
          >
            <label>
              Friend&apos;s account
              email
              <input
                name="email"
                type="email"
                placeholder="friend@email.com"
                required
              />
            </label>

            <button type="submit">
              Invite Study Partner
            </button>
          </form>

          <div className="partnerList">
            {partners.map(
              (partner) => (
                <div
                  className="partnerRow"
                  key={partner.id}
                >
                  <div>
                    <small>
                      STUDY PARTNER
                    </small>
                    <b>
                      {partner.invite_email ||
                        'Connected account'}
                    </b>
                  </div>

                  <strong>
                    {partner.status}
                  </strong>
                </div>
              )
            )}
          </div>
        </section>

        <section className="card">
          <div className="sectionTitle">
            <div>
              <small>
                SESSION
              </small>
              <h2>
                Plan Study Together
              </h2>
            </div>
          </div>

          <form
            className="form"
            onSubmit={
              addSharedSession
            }
          >
            <label>
              Date
              <input
                name="date"
                type="date"
                defaultValue={today}
                required
              />
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
              <select
                name="type"
                defaultValue="CARS"
              >
                <option>CARS</option>
                <option>
                  Full Length
                </option>
                <option>
                  Full Length Review
                </option>
                <option>
                  Weakness Review
                </option>
                <option>
                  Study Session
                </option>
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

            <button type="submit">
              Create Session
            </button>
          </form>
        </section>
      </div>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>
              UPCOMING / RECENT
            </small>
            <h2>
              Shared Sessions
            </h2>
          </div>
        </div>

        <div className="logList">
          {sharedSessions.map(
            (item) => (
              <div
                className="logRow"
                key={item.id}
              >
                <div>
                  <small>
                    {
                      item.session_date
                    }{' '}
                    •{' '}
                    {
                      item.session_type
                    }
                  </small>
                  <b>
                    {item.title}
                  </b>
                </div>

                <strong>
                  {formatMinutes(
                    item.planned_minutes
                  )}
                </strong>
              </div>
            )
          )}

          {!sharedSessions.length && (
            <p className="empty">
              No shared study
              sessions yet.
            </p>
          )}
        </div>
      </section>
    </>
  )
}

function AnalyticsView({
  tasks,
  questionLogs,
  fullLengths,
  studySessions,
  weaknesses,
  chapters,
}) {
  const completedTasks =
    tasks.filter(
      (task) => task.completed
    ).length

  const totalQuestions =
    questionLogs.reduce(
      (sum, log) =>
        sum +
        Number(
          log.total_questions || 0
        ),
      0
    )

  const totalCorrect =
    questionLogs.reduce(
      (sum, log) =>
        sum +
        Number(
          log.correct_questions || 0
        ),
      0
    )

  const accuracy =
    totalQuestions > 0
      ? Math.round(
          (totalCorrect /
            totalQuestions) *
            100
        )
      : 0

  const focusedMinutes =
    studySessions.reduce(
      (sum, item) =>
        sum +
        Number(
          item.actual_minutes || 0
        ),
      0
    )

  const redWeaknesses =
    weaknesses.filter(
      (item) =>
        item.mastery_level === 'red'
    ).length

  const chapterCount =
    chapters.filter(
      (chapter) =>
        chapter.status ===
        'completed'
    ).length

  return (
    <div className="analyticsGrid">
      <MetricCard
        label="QUESTIONS"
        value={totalQuestions}
        detail={`${accuracy}% overall accuracy`}
      />

      <MetricCard
        label="FOCUSED TIME"
        value={formatMinutes(
          focusedMinutes
        )}
        detail="Pomodoro study time"
      />

      <MetricCard
        label="TASKS"
        value={completedTasks}
        detail="completed"
      />

      <MetricCard
        label="RED WEAKNESSES"
        value={redWeaknesses}
        detail="need repair"
      />

      <MetricCard
        label="KAPLAN"
        value={`${chapterCount}/${chapters.length}`}
        detail="chapters completed"
      />

      <MetricCard
        label="FULL LENGTHS"
        value={fullLengths.length}
        detail={
          fullLengths[0]
            ? `Latest: ${fullLengths[0].total_score}`
            : 'None logged'
        }
      />
    </div>
  )
}

function MetricCard({
  label,
  value,
  detail,
}) {
  return (
    <section className="card statCard">
      <small>{label}</small>
      <b>{value}</b>
      <span>{detail}</span>
    </section>
  )
}

function SettingsView({
  preferences,
  studyTrack,
  countdown,
  updateDisplayName,
  changeStudyTrack,
}) {
  return (
    <div className="settingsGrid">
      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>PROFILE</small>
            <h2>Study Profile</h2>
          </div>
        </div>

        <form
          className="form"
          onSubmit={
            updateDisplayName
          }
        >
          <label>
            Display name
            <input
              name="name"
              defaultValue={
                preferences?.display_name ||
                ''
              }
              placeholder="Your name"
            />
          </label>

          <button type="submit">
            Save name
          </button>
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
          Your account should use
          Question Track. Your study
          partner can choose Content
          Track on their own account.
        </p>

        <div className="trackChoices">
          <button
            className={
              studyTrack ===
              'questions'
                ? 'activeChoice'
                : ''
            }
            onClick={() =>
              changeStudyTrack(
                'questions'
              )
            }
          >
            <b>Question Track</b>
            <span>
              Kaplan / UWorld / AAMC
              + targeted repair
            </span>
          </button>

          <button
            className={
              studyTrack ===
              'content'
                ? 'activeChoice'
                : ''
            }
            onClick={() =>
              changeStudyTrack(
                'content'
              )
            }
          >
            <b>Content Track</b>
            <span>
              Kaplan chapters +
              questions + recall
            </span>
          </button>
        </div>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <small>EXAM</small>
            <h2>
              January 21, 2027
            </h2>
          </div>
        </div>

        <div className="bigMetric">
          <b>{countdown}</b>
          <span>
            days remaining
          </span>
        </div>

        <p>
          Target score:{' '}
          {preferences?.target_score ||
            512}+
        </p>
      </section>
    </div>
  )
}
