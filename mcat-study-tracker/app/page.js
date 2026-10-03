'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import config from '../data/studyConfig.json'

const EXAM_DATE = config.exam?.date || '2027-01-21'
const PLAN_START = config.global_rules?.plan_start || '2026-10-03'
const SOURCE_TYPE = 'v2_engine'

const STUDENTS = {
  Diya: {
    name: 'Diya',
    track: config.diya?.track_name || 'Question-Heavy Track',
    target: config.diya?.target_score || 512
  },
  Hamzah: {
    name: 'Hamzah',
    track: config.hamzah?.track_name || 'Content + Question Track',
    target: config.hamzah?.target_score || 512
  }
}

/* ============================================================
   DATE HELPERS
   ============================================================ */

function localISO(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dateFromISO(iso) {
  if (!iso) return new Date()
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(iso, amount) {
  const date = dateFromISO(iso)
  date.setDate(date.getDate() + amount)
  return localISO(date)
}

function daysBetween(start, end) {
  const a = dateFromISO(start)
  const b = dateFromISO(end)
  return Math.round((b - a) / 86400000)
}

function formatDate(iso, options = {}) {
  if (!iso) return ''
  return dateFromISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: options.year ? 'numeric' : undefined,
    weekday: options.weekday ? 'short' : undefined
  })
}

function formatMinutes(minutes = 0) {
  const n = Math.max(0, Math.round(Number(minutes) || 0))
  const h = Math.floor(n / 60)
  const m = n % 60

  if (!h) return `${m}m`
  if (!m) return `${h}h`

  return `${h}h ${m}m`
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function isBetween(date, start, end) {
  return date >= start && date <= end
}

function getWeekDates(iso) {
  const date = dateFromISO(iso)
  const day = date.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setDate(date.getDate() + mondayOffset)

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return localISO(d)
  })
}

function getPhase(phases = [], iso) {
  return (
    phases.find(
      phase => iso >= phase.start && iso <= phase.end
    ) || null
  )
}

function getHamzahRamp(iso) {
  return (
    config.hamzah?.ramp?.find(
      ramp => iso >= ramp.start && iso <= ramp.end
    ) || null
  )
}

function getSubject(rotation = [], iso) {
  if (!rotation.length) return 'Mixed'

  const diff = Math.max(0, daysBetween(PLAN_START, iso))
  return rotation[diff % rotation.length]
}

function isLightDay(iso) {
  if (iso < PLAN_START || iso >= EXAM_DATE) return false

  const diff = daysBetween(PLAN_START, iso)

  // Every 7th study day.
  return diff >= 0 && diff % 7 === 6
}

function isFullLengthDay(iso) {
  return (config.shared?.full_length_dates || []).includes(iso)
}

function isFullLengthReviewDay(iso) {
  const flDates = config.shared?.full_length_dates || []
  return flDates.some(date => addDays(date, 1) === iso)
}

function average(min, max) {
  if (min == null && max == null) return 0
  if (max == null) return Number(min) || 0
  if (min == null) return Number(max) || 0
  return Math.round((Number(min) + Number(max)) / 2)
}

/* ============================================================
   TASK HELPERS
   ============================================================ */

function makeTask({
  student,
  date,
  type,
  title,
  description = '',
  resource = '',
  subject = '',
  minutes = 0,
  priority = 2,
  sort = 0
}) {
  return {
    student_name: student,
    task_date: date,
    current_due_date: date,
    task_type: type,
    title,
    description,
    resource,
    subject,
    estimated_minutes: Math.max(0, Math.round(minutes)),
    priority,
    sort_order: sort,
    completed: false,
    source_type: SOURCE_TYPE,
    status: 'scheduled',
    carried_forward: false,
    carry_count: 0
  }
}

function taskMinutes(tasks = []) {
  return tasks.reduce(
    (sum, task) => sum + (Number(task.estimated_minutes) || 0),
    0
  )
}

function completedMinutes(tasks = []) {
  return tasks
    .filter(task => task.completed)
    .reduce(
      (sum, task) => sum + (Number(task.estimated_minutes) || 0),
      0
    )
}

function taskProgress(tasks = []) {
  if (!tasks.length) return 0

  const completed = tasks.filter(task => task.completed).length
  return Math.round((completed / tasks.length) * 100)
}

/* ============================================================
   DIYA TASK GENERATOR
   ============================================================ */

function generateDiyaTasks(iso) {
  if (iso < PLAN_START || iso > EXAM_DATE) return []

  if (iso === EXAM_DATE) {
    return [
      makeTask({
        student: 'Diya',
        date: iso,
        type: 'Exam',
        title: 'MCAT DAY',
        description:
          'You made it. No study workload today. Follow your exam-day routine.',
        resource: 'MCAT',
        minutes: 0,
        priority: 1,
        sort: 1
      })
    ]
  }

  if (isFullLengthDay(iso)) {
    return [
      makeTask({
        student: 'Diya',
        date: iso,
        type: 'Full Length',
        title: 'Full-Length MCAT',
        description:
          'Take the full-length under realistic testing conditions. Protect this day from normal overflow.',
        resource: 'AAMC / Scheduled FL',
        subject: 'Full MCAT',
        minutes: 450,
        priority: 1,
        sort: 1
      }),
      makeTask({
        student: 'Diya',
        date: iso,
        type: 'Anki',
        title: 'Light Anki only',
        description:
          'Optional light review after the exam. Do not turn FL day into another full study day.',
        resource: 'Anki',
        minutes: 20,
        priority: 3,
        sort: 2
      })
    ]
  }

  if (isFullLengthReviewDay(iso)) {
    return [
      makeTask({
        student: 'Diya',
        date: iso,
        type: 'Review',
        title: 'Deep full-length review',
        description:
          'Review every incorrect, guessed, uncertain, and poorly reasoned question. Update the error log and weaknesses.',
        resource: 'Full Length',
        subject: 'Mixed',
        minutes: 240,
        priority: 1,
        sort: 1
      }),
      makeTask({
        student: 'Diya',
        date: iso,
        type: 'Weakness',
        title: 'Convert FL misses into weakness targets',
        description:
          'Identify patterns rather than isolated mistakes. Add meaningful weaknesses for retesting.',
        resource: 'Error Log',
        subject: 'Mixed',
        minutes: 45,
        priority: 1,
        sort: 2
      }),
      makeTask({
        student: 'Diya',
        date: iso,
        type: 'CARS',
        title: '2 timed CARS passages',
        description: 'Keep CARS reasoning active after FL review.',
        resource: 'AAMC / CARS',
        subject: 'CARS',
        minutes: 50,
        priority: 2,
        sort: 3
      }),
      makeTask({
        student: 'Diya',
        date: iso,
        type: 'Anki',
        title: 'Anki — 30 minutes',
        description: 'Due cards plus important FL-derived cards.',
        resource: 'Anki',
        minutes: 30,
        priority: 2,
        sort: 4
      })
    ]
  }

  const phase = getPhase(config.diya?.phases || [], iso)

  if (!phase) return []

  if (isLightDay(iso)) {
    const light = config.diya?.light_day || {}

    return [
      makeTask({
        student: 'Diya',
        date: iso,
        type: 'CARS',
        title: `${light.cars_passages || 2} timed CARS passages + review`,
        resource: phase.primary_resource || 'CARS',
        subject: 'CARS',
        minutes: 55,
        priority: 1,
        sort: 1
      }),
      makeTask({
        student: 'Diya',
        date: iso,
        type: 'Anki',
        title: `Anki — ${light.anki_minutes || 35} minutes`,
        description: 'Due cards and meaningful mistake cards.',
        resource: 'Anki',
        minutes: light.anki_minutes || 35,
        priority: 2,
        sort: 2
      }),
      makeTask({
        student: 'Diya',
        date: iso,
        type: 'Review',
        title: 'Error log + weakness review',
        description:
          'Review high-value errors and previously identified weak topics.',
        resource: 'Error Log',
        subject: 'Mixed',
        minutes: light.error_review_minutes || 60,
        priority: 2,
        sort: 3
      }),
      makeTask({
        student: 'Diya',
        date: iso,
        type: 'Overflow',
        title: 'Catch-up / protected recovery block',
        description:
          'Use this for important carried work. If caught up, stop early and recover.',
        resource: 'Catch-up',
        minutes: light.catch_up_minutes || 75,
        priority: 2,
        sort: 4
      })
    ]
  }

  const subject = getSubject(config.diya?.subject_rotation || [], iso)

  const questions = average(
    phase.question_target_min,
    phase.question_target_max
  )

  const cars = average(
    phase.cars_passages_min,
    phase.cars_passages_max
  )

  const targetedQuestions =
    Number(phase.targeted_questions) || 15

  // Keep planned time close to a realistic 5–6 hour day.
  const primaryQuestionMinutes = Math.max(
    80,
    Math.round(questions * 1.55)
  )

  const deepReviewMinutes = Math.min(
    Number(phase.review_minutes) || 150,
    120
  )

  return [
    makeTask({
      student: 'Diya',
      date: iso,
      type: 'Questions',
      title: `${questions} timed ${subject} questions`,
      description:
        'Work under timed conditions. Flag guesses and uncertain answers for review.',
      resource: phase.primary_resource,
      subject,
      minutes: primaryQuestionMinutes,
      priority: 1,
      sort: 1
    }),

    makeTask({
      student: 'Diya',
      date: iso,
      type: 'Review',
      title: 'Deep question review',
      description:
        'Review incorrect, guessed, uncertain, and poorly reasoned correct answers.',
      resource: phase.primary_resource,
      subject,
      minutes: deepReviewMinutes,
      priority: 1,
      sort: 2
    }),

    makeTask({
      student: 'Diya',
      date: iso,
      type: 'Questions',
      title: `${targetedQuestions} targeted weakness questions`,
      description:
        'Use your weakest active topic. Prioritize understanding over volume.',
      resource: phase.secondary_resource || phase.primary_resource,
      subject: 'Weakness',
      minutes: 50,
      priority: 1,
      sort: 3
    }),

    makeTask({
      student: 'Diya',
      date: iso,
      type: 'CARS',
      title: `${cars} timed CARS passages + review`,
      description:
        'Practice passage reasoning and review why each wrong answer was wrong.',
      resource:
        phase.primary_resource === 'AAMC'
          ? 'AAMC CARS'
          : 'CARS',
      subject: 'CARS',
      minutes: Math.max(45, cars * 22),
      priority: 1,
      sort: 4
    }),

    makeTask({
      student: 'Diya',
      date: iso,
      type: 'Anki',
      title: `Anki — ${phase.anki_minutes || 40} minutes`,
      description:
        'Due cards first. Add cards only for meaningful knowledge gaps.',
      resource: 'Anki',
      minutes: phase.anki_minutes || 40,
      priority: 2,
      sort: 5
    }),

    makeTask({
      student: 'Diya',
      date: iso,
      type: 'Content',
      title: `Targeted content repair — ${
        phase.targeted_repair_minutes || 40
      } minutes`,
      description:
        'Repair only weaknesses exposed by questions. No broad passive content pass.',
      resource: phase.secondary_resource || 'Targeted Review',
      subject,
      minutes: phase.targeted_repair_minutes || 40,
      priority: 2,
      sort: 6
    }),

    makeTask({
      student: 'Diya',
      date: iso,
      type: 'Recall',
      title: `Closed-book recall — ${
        phase.recall_minutes || 20
      } minutes`,
      description:
        'Without notes, explain equations, mechanisms, pathways, and concepts from today.',
      resource: 'Active Recall',
      subject,
      minutes: phase.recall_minutes || 20,
      priority: 2,
      sort: 7
    })
  ]
}

/* ============================================================
   HAMZAH CHAPTER HELPERS
   ============================================================ */

function getCompletedHamzahChapterSequences(tasks = []) {
  const completed = new Set()

  tasks.forEach(task => {
    if (
      task.student_name !== 'Hamzah' ||
      !task.completed ||
      task.task_type !== 'Chapter'
    ) {
      return
    }

    const match = String(task.description || '').match(
      /chapter_sequence:(\d+)/
    )

    if (match) {
      completed.add(Number(match[1]))
    }
  })

  return completed
}

function getCurrentHamzahChapter(allTasks = []) {
  const chapters = config.hamzah?.chapters || []

  if (!chapters.length) return null

  const completed = getCompletedHamzahChapterSequences(allTasks)

  return (
    chapters.find(chapter => !completed.has(chapter.sequence)) ||
    chapters[chapters.length - 1]
  )
}

function hamzahChapterLabel(chapter) {
  if (!chapter) return 'Kaplan content'

  return `${chapter.subject} Ch. ${chapter.chapter}: ${chapter.title}`
}

/* ============================================================
   HAMZAH TASK GENERATOR
   ============================================================ */

function generateHamzahTasks(iso, currentChapter) {
  if (iso < PLAN_START || iso > EXAM_DATE) return []

  if (iso === EXAM_DATE) {
    return [
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Exam',
        title: 'MCAT DAY',
        description:
          'You made it. No study workload today. Follow your exam-day routine.',
        resource: 'MCAT',
        minutes: 0,
        priority: 1,
        sort: 1
      })
    ]
  }

  if (isFullLengthDay(iso)) {
    return [
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Full Length',
        title: 'Full-Length MCAT',
        description:
          'Take the same scheduled full-length as Diya under realistic testing conditions.',
        resource: 'AAMC / Scheduled FL',
        subject: 'Full MCAT',
        minutes: 450,
        priority: 1,
        sort: 1
      }),
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Anki',
        title: 'Light Anki only',
        description:
          'Optional light review after the exam. Protect recovery.',
        resource: 'Anki',
        minutes: 20,
        priority: 3,
        sort: 2
      })
    ]
  }

  if (isFullLengthReviewDay(iso)) {
    return [
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Review',
        title: 'Deep full-length review',
        description:
          'Review incorrect, guessed, uncertain, and poorly reasoned questions.',
        resource: 'Full Length',
        subject: 'Mixed',
        minutes: 210,
        priority: 1,
        sort: 1
      }),
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Weakness',
        title: 'Turn FL misses into weakness targets',
        description:
          'Record recurring content and reasoning weaknesses for retesting.',
        resource: 'Error Log',
        subject: 'Mixed',
        minutes: 40,
        priority: 1,
        sort: 2
      }),
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'CARS',
        title: '2 timed CARS passages + review',
        resource: 'CARS',
        subject: 'CARS',
        minutes: 50,
        priority: 2,
        sort: 3
      }),
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Anki',
        title: 'Anki — 30 minutes',
        resource: 'Anki',
        minutes: 30,
        priority: 2,
        sort: 4
      })
    ]
  }

  const phase = getPhase(config.hamzah?.phases || [], iso)
  const ramp = getHamzahRamp(iso)

  if (!phase) return []

  const chapter = currentChapter
  const chapterLabel = hamzahChapterLabel(chapter)

  /*
   * During the ramp, the ramp values override full-volume
   * phase values.
   */

  const rampIsActive =
    ramp && ramp.id !== 'full_workload'

  if (rampIsActive) {
    const target = Number(ramp.target_minutes) || 60
    const qCount = Number(ramp.question_target) || 8
    const cars = Number(ramp.cars_passages) || 1
    const anki = Number(ramp.anki_minutes) || 10
    const recall = Number(ramp.recall_minutes) || 5
    const review = Number(ramp.review_minutes) || 10

    /*
     * We scale the content block around the remaining target.
     * This prevents week one from becoming a fake 3-hour day.
     */
    const carsMinutes = cars * 18
    const questionMinutes = Math.max(12, qCount * 1.4)

    let contentMinutes =
      target -
      carsMinutes -
      questionMinutes -
      anki -
      recall -
      review

    contentMinutes = clamp(
      contentMinutes,
      10,
      Number(ramp.chapter_minutes) || target
    )

    return [
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Content',
        title: `Kaplan: ${chapterLabel}`,
        description:
          'Continue the current chapter. You do not need to finish the entire chapter today during the ramp.',
        resource: 'Kaplan Books',
        subject: chapter?.subject || '',
        minutes: contentMinutes,
        priority: 1,
        sort: 1
      }),

      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Questions',
        title: `${qCount} related Kaplan questions`,
        description:
          'Apply the concepts from the current chapter. Flag misses and guesses.',
        resource: 'Kaplan QBank',
        subject: chapter?.subject || '',
        minutes: questionMinutes,
        priority: 1,
        sort: 2
      }),

      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Review',
        title: `Review misses — ${review} minutes`,
        description:
          'Understand why the wrong answer was wrong and why the correct answer is correct.',
        resource: 'Kaplan QBank',
        subject: chapter?.subject || '',
        minutes: review,
        priority: 1,
        sort: 3
      }),

      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'CARS',
        title: `${cars} timed CARS ${
          cars === 1 ? 'passage' : 'passages'
        } + review`,
        resource: 'CARS',
        subject: 'CARS',
        minutes: carsMinutes,
        priority: 2,
        sort: 4
      }),

      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Anki',
        title: `Anki — ${anki} minutes`,
        description:
          'Review due cards and add only meaningful concepts from the chapter or missed questions.',
        resource: 'Anki',
        minutes: anki,
        priority: 2,
        sort: 5
      }),

      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Recall',
        title: `Closed-book recall — ${recall} minutes`,
        description:
          'Without notes, explain the most important concepts studied today.',
        resource: 'Active Recall',
        subject: chapter?.subject || '',
        minutes: recall,
        priority: 2,
        sort: 6
      }),

      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Chapter',
        title: `Mark chapter complete: ${chapterLabel}`,
        description: `chapter_sequence:${
          chapter?.sequence || 1
        } | Only check this when the entire Kaplan chapter, concept checks, and chapter questions are actually complete.`,
        resource: 'Kaplan Books',
        subject: chapter?.subject || '',
        minutes: 0,
        priority: 3,
        sort: 7
      })
    ]
  }

  /*
   * FULL WORKLOAD
   */

  const questionCount = average(
    phase.question_target_min,
    phase.question_target_max
  )

  const cars = average(
    phase.cars_passages_min,
    phase.cars_passages_max
  )

  const anki = Number(phase.anki_minutes) || 35
  const recall = Number(phase.recall_minutes) || 20

  const questionReview = Math.min(
    Number(phase.question_review_minutes) || 120,
    120
  )

  const stillContentHeavy =
    phase.id === 'kaplan_uworld_transition' ||
    phase.id === 'uworld_build'

  const tasks = []

  if (stillContentHeavy && chapter) {
    tasks.push(
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Content',
        title: `Kaplan: ${chapterLabel}`,
        description:
          phase.id === 'uworld_build'
            ? 'Continue the next unfinished Kaplan chapter. Keep content efficient because UWorld is now the primary learning tool.'
            : 'Continue the next unfinished Kaplan chapter, including concept checks and chapter questions.',
        resource: 'Kaplan Books',
        subject: chapter.subject,
        minutes:
          phase.id === 'uworld_build'
            ? 60
            : Math.min(Number(phase.chapter_minutes) || 90, 90),
        priority: 1,
        sort: 1
      })
    )
  }

  tasks.push(
    makeTask({
      student: 'Hamzah',
      date: iso,
      type: 'Questions',
      title: `${questionCount} ${phase.question_resource || phase.primary_resource} questions`,
      description:
        'Use timed passage-based practice. Flag incorrect, guessed, and uncertain questions.',
      resource: phase.question_resource || phase.primary_resource,
      subject: getSubject(
        config.hamzah?.subject_rotation || [],
        iso
      ),
      minutes: Math.max(
        55,
        Math.round(questionCount * 1.45)
      ),
      priority: 1,
      sort: 2
    }),

    makeTask({
      student: 'Hamzah',
      date: iso,
      type: 'Review',
      title: 'Deep question review',
      description:
        'Review every incorrect, guessed, uncertain, and poorly reasoned correct answer.',
      resource: phase.question_resource || phase.primary_resource,
      subject: 'Mixed',
      minutes: questionReview,
      priority: 1,
      sort: 3
    }),

    makeTask({
      student: 'Hamzah',
      date: iso,
      type: 'CARS',
      title: `${cars} timed CARS passages + review`,
      description:
        'Maintain daily CARS reasoning and review the logic behind missed answers.',
      resource:
        phase.primary_resource === 'AAMC'
          ? 'AAMC CARS'
          : 'CARS',
      subject: 'CARS',
      minutes: Math.max(45, cars * 22),
      priority: 1,
      sort: 4
    }),

    makeTask({
      student: 'Hamzah',
      date: iso,
      type: 'Anki',
      title: `Anki — ${anki} minutes`,
      description:
        'Due cards first. Add cards from meaningful misses and high-yield content gaps.',
      resource: 'Anki',
      minutes: anki,
      priority: 2,
      sort: 5
    })
  )

  if (phase.targeted_repair_minutes) {
    tasks.push(
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Content',
        title: `Targeted weakness repair — ${phase.targeted_repair_minutes} minutes`,
        description:
          'Review only content gaps exposed by practice questions.',
        resource: phase.secondary_resource || 'Targeted Review',
        subject: 'Weakness',
        minutes: phase.targeted_repair_minutes,
        priority: 2,
        sort: 6
      })
    )
  }

  tasks.push(
    makeTask({
      student: 'Hamzah',
      date: iso,
      type: 'Recall',
      title: `Closed-book recall — ${recall} minutes`,
      description:
        'Explain major concepts, equations, pathways, and reasoning without notes.',
      resource: 'Active Recall',
      subject: 'Mixed',
      minutes: recall,
      priority: 2,
      sort: 7
    })
  )

  if (stillContentHeavy && chapter) {
    tasks.push(
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Chapter',
        title: `Mark chapter complete: ${chapterLabel}`,
        description: `chapter_sequence:${chapter.sequence} | Only check this when the entire chapter, concept checks, and end-of-chapter work are complete.`,
        resource: 'Kaplan Books',
        subject: chapter.subject,
        minutes: 0,
        priority: 3,
        sort: 8
      })
    )
  }

  return tasks
}

/* ============================================================
   APP
   ============================================================ */

export default function Home() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState('signin')

  const [view, setView] = useState('Today')
  const [message, setMessage] = useState('')

  const [tasks, setTasks] = useState([])
  const [questionLogs, setQuestionLogs] = useState([])
  const [fullLengths, setFullLengths] = useState([])
  const [studySessions, setStudySessions] = useState([])

  const [selectedDate, setSelectedDate] = useState(localISO())

  const uid = session?.user?.id || null

  /* ----------------------------------------------------------
     AUTH
     ---------------------------------------------------------- */

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null)
      setLoading(false)
    })

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession || null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleAuth(e) {
    e.preventDefault()
    setMessage('')

    if (!supabase) {
      setMessage('Supabase is not configured.')
      return
    }

    let result

    if (authMode === 'signup') {
      result = await supabase.auth.signUp({
        email,
        password
      })
    } else {
      result = await supabase.auth.signInWithPassword({
        email,
        password
      })
    }

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setMessage(
      authMode === 'signup'
        ? 'Account created. Check your email if confirmation is required.'
        : ''
    )
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  /* ----------------------------------------------------------
     LOAD DATA
     ---------------------------------------------------------- */

  async function loadAll() {
    if (!uid || !supabase) return

    const [
      taskResult,
      questionResult,
      flResult,
      sessionResult
    ] = await Promise.all([
      supabase
        .from('daily_tasks')
        .select('*')
        .eq('user_id', uid)
        .order('task_date', { ascending: true })
        .order('sort_order', { ascending: true }),

      supabase
        .from('question_blocks')
        .select('*')
        .eq('user_id', uid)
        .order('question_date', { ascending: false }),

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
    ])

    if (taskResult.data) setTasks(taskResult.data)
    if (questionResult.data) setQuestionLogs(questionResult.data)
    if (flResult.data) setFullLengths(flResult.data)
    if (sessionResult.data) setStudySessions(sessionResult.data)
  }

  useEffect(() => {
    if (!uid) return
    loadAll()
  }, [uid])

  /* ----------------------------------------------------------
     CURRENT CHAPTER
     ---------------------------------------------------------- */

  const currentHamzahChapter = useMemo(
    () => getCurrentHamzahChapter(tasks),
    [tasks]
  )

  /* ----------------------------------------------------------
     SEED TODAY
     ---------------------------------------------------------- */

  async function seedDay(iso) {
    if (!uid || !supabase) return

    if (iso < PLAN_START || iso > EXAM_DATE) return

    const existing = tasks.filter(
      task =>
        task.source_type === SOURCE_TYPE &&
        task.task_date === iso
    )

    const existingStudents = new Set(
      existing.map(task => task.student_name)
    )

    const inserts = []

    if (!existingStudents.has('Diya')) {
      generateDiyaTasks(iso).forEach(task => {
        inserts.push({
          ...task,
          user_id: uid
        })
      })
    }

    if (!existingStudents.has('Hamzah')) {
      generateHamzahTasks(
        iso,
        currentHamzahChapter
      ).forEach(task => {
        inserts.push({
          ...task,
          user_id: uid
        })
      })
    }

    if (!inserts.length) return

    const { error } = await supabase
      .from('daily_tasks')
      .insert(inserts)

    if (error) {
      console.error(error)
      setMessage(
        `Schedule error: ${error.message}`
      )
      return
    }

    await loadAll()
  }

  useEffect(() => {
    if (!uid) return
    seedDay(selectedDate)
  }, [uid, selectedDate, tasks.length])

  /* ----------------------------------------------------------
     OVERFLOW
     ---------------------------------------------------------- */

  async function processOverflow() {
    if (!uid || !supabase) return

    const today = localISO()

    if (today <= PLAN_START || today >= EXAM_DATE) return

    if (isFullLengthDay(today)) return

    const { data: overdue, error } = await supabase
      .from('daily_tasks')
      .select('*')
      .eq('user_id', uid)
      .eq('source_type', SOURCE_TYPE)
      .eq('completed', false)
      .gte('task_date', PLAN_START)
      .lt('task_date', today)
      .neq('task_type', 'Exam')
      .neq('task_type', 'Chapter')

    if (error) {
      console.error(error)
      return
    }

    for (const task of overdue || []) {
      if (task.current_due_date === today) continue

      await supabase
        .from('daily_tasks')
        .update({
          current_due_date: today,
          carried_forward: true,
          carry_count:
            (Number(task.carry_count) || 0) + 1,
          status: 'overdue'
        })
        .eq('id', task.id)
        .eq('user_id', uid)
    }

    await loadAll()
  }

  useEffect(() => {
    if (!uid) return
    processOverflow()
  }, [uid])

  /* ----------------------------------------------------------
     TASK ACTIONS
     ---------------------------------------------------------- */

  async function toggleTask(task) {
    if (!uid || !supabase) return

    const completed = !task.completed

    const payload = {
      completed,
      status: completed
        ? 'completed'
        : task.carried_forward
          ? 'overdue'
          : 'scheduled'
    }

    if (completed) {
      payload.completed_at = new Date().toISOString()
    } else {
      payload.completed_at = null
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

    await loadAll()
  }

  /* ----------------------------------------------------------
     FILTERED TASKS
     ---------------------------------------------------------- */

  const v2Tasks = useMemo(
    () =>
      tasks.filter(
        task =>
          task.source_type === SOURCE_TYPE &&
          task.task_date >= PLAN_START
      ),
    [tasks]
  )

  function studentTasks(student, iso) {
    return v2Tasks
      .filter(
        task =>
          task.student_name === student &&
          task.task_date === iso
      )
      .sort(
        (a, b) =>
          (Number(a.sort_order) || 0) -
          (Number(b.sort_order) || 0)
      )
  }

  function studentOverflow(student, iso) {
    return v2Tasks.filter(
      task =>
        task.student_name === student &&
        !task.completed &&
        task.carried_forward &&
        task.current_due_date === iso &&
        task.task_date < iso &&
        task.task_type !== 'Chapter'
    )
  }

  const diyaSelectedTasks = studentTasks(
    'Diya',
    selectedDate
  )

  const hamzahSelectedTasks = studentTasks(
    'Hamzah',
    selectedDate
  )

  const diyaOverflow = studentOverflow(
    'Diya',
    selectedDate
  )

  const hamzahOverflow = studentOverflow(
    'Hamzah',
    selectedDate
  )

  /* ----------------------------------------------------------
     QUESTION LOGGING
     ---------------------------------------------------------- */

  async function addQuestionBlock(data) {
    if (!uid || !supabase) return

    const payload = {
      user_id: uid,
      question_date: data.date,
      source: `${data.student} — ${data.source}`,
      subject: data.subject,
      total_questions: Number(data.total),
      correct_questions: Number(data.correct),
      timed: Boolean(data.timed)
    }

    const { error } = await supabase
      .from('question_blocks')
      .insert(payload)

    if (error) {
      setMessage(error.message)
      return
    }

    await loadAll()
  }

  /* ----------------------------------------------------------
     FULL LENGTH LOGGING
     ---------------------------------------------------------- */

  async function addFullLength(data) {
    if (!uid || !supabase) return

    const total =
      Number(data.cp || 0) +
      Number(data.cars || 0) +
      Number(data.bb || 0) +
      Number(data.ps || 0)

    const payload = {
      user_id: uid,
      exam_date: data.date,
      exam_name: `${data.student} — ${data.name}`,
      cp_score: Number(data.cp),
      cars_score: Number(data.cars),
      bb_score: Number(data.bb),
      ps_score: Number(data.ps),
      total_score: total
    }

    const { error } = await supabase
      .from('full_length_scores')
      .insert(payload)

    if (error) {
      setMessage(error.message)
      return
    }

    await loadAll()
  }

  /* ----------------------------------------------------------
     STUDY SESSION
     ---------------------------------------------------------- */

  async function logSession(student, minutes, type = 'Focus') {
    if (!uid || !supabase || !minutes) return

    const payload = {
      user_id: uid,
      session_date: localISO(),
      actual_minutes: Number(minutes),
      planned_minutes: Number(minutes),
      session_type: `${student} — ${type}`,
      ended_at: new Date().toISOString()
    }

    const { error } = await supabase
      .from('study_sessions')
      .insert(payload)

    if (error) {
      console.error(error)
      return
    }

    await loadAll()
  }

  /* ----------------------------------------------------------
     AUTH SCREEN
     ---------------------------------------------------------- */

  if (loading) {
    return (
      <div className="auth">
        <div className="card authCard">
          <h1>MCAT Study Tracker</h1>
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="auth">
        <form
          className="card authCard"
          onSubmit={handleAuth}
        >
          <div className="logo">
            <span>M</span>
            <div>
              <b>MCAT TRACKER</b>
              <small>JANUARY 21, 2027</small>
            </div>
          </div>

          <h1>
            {authMode === 'signin'
              ? 'Welcome back'
              : 'Create account'}
          </h1>

          <p>
            Diya + Hamzah MCAT Study System
          </p>

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e =>
              setEmail(e.target.value)
            }
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e =>
              setPassword(e.target.value)
            }
            required
          />

          <button type="submit">
            {authMode === 'signin'
              ? 'Sign In'
              : 'Create Account'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() =>
              setAuthMode(
                authMode === 'signin'
                  ? 'signup'
                  : 'signin'
              )
            }
          >
            {authMode === 'signin'
              ? 'Need an account?'
              : 'Already have an account?'}
          </button>

          {message && (
            <div className="message">
              {message}
            </div>
          )}
        </form>
      </div>
    )
  }

  const daysLeft = Math.max(
    0,
    daysBetween(localISO(), EXAM_DATE)
  )

  /* ----------------------------------------------------------
     MAIN APP
     ---------------------------------------------------------- */

  return (
    <div className="shell">
      <aside className="aside">
        <div className="logo">
          <span>M</span>

          <div>
            <b>MCAT TRACKER</b>
            <small>V4 STUDY SYSTEM</small>
          </div>
        </div>

        <div className="profileMini">
          <small>SHARED ACCOUNT</small>
          <b>Diya + Hamzah</b>
          <span>Target: 512+</span>
        </div>

        <nav>
          {[
            'Today',
            'Calendar',
            'Questions',
            'Full Lengths',
            'Together',
            'Analytics'
          ].map(item => (
            <button
              key={item}
              className={
                view === item ? 'active' : ''
              }
              onClick={() => setView(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sideExam">
          <small>MCAT</small>
          <b>{daysLeft}</b>
          <span>days remaining</span>
        </div>

        <button
          className="secondary"
          onClick={signOut}
        >
          Sign Out
        </button>
      </aside>

      <main className="content">
        <header className="header">
          <div>
            <h1>{view}</h1>

            <p>
              Diya + Hamzah • MCAT January 21,
              2027
            </p>
          </div>

          <div className="headerRight">
            <div className="countdown">
              <b>{daysLeft}</b>
              <span>DAYS TO MCAT</span>
            </div>
          </div>
        </header>

        {message && (
          <div className="message">
            {message}
          </div>
        )}

        {view === 'Today' && (
          <TodayView
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            diyaTasks={diyaSelectedTasks}
            hamzahTasks={hamzahSelectedTasks}
            diyaOverflow={diyaOverflow}
            hamzahOverflow={hamzahOverflow}
            allTasks={v2Tasks}
            currentHamzahChapter={
              currentHamzahChapter
            }
            toggleTask={toggleTask}
            logSession={logSession}
            seedDay={seedDay}
          />
        )}

        {view === 'Calendar' && (
          <CalendarView
            selectedDate={selectedDate}
            setSelectedDate={date => {
              setSelectedDate(date)
              setView('Today')
            }}
            tasks={v2Tasks}
          />
        )}

        {view === 'Questions' && (
          <QuestionsView
            logs={questionLogs}
            onAdd={addQuestionBlock}
          />
        )}

        {view === 'Full Lengths' && (
          <FullLengthView
            fullLengths={fullLengths}
            onAdd={addFullLength}
          />
        )}

        {view === 'Together' && (
          <TogetherView
            selectedDate={selectedDate}
            tasks={v2Tasks}
            sessions={studySessions}
          />
        )}

        {view === 'Analytics' && (
          <AnalyticsView
            tasks={v2Tasks}
            questionLogs={questionLogs}
            fullLengths={fullLengths}
            sessions={studySessions}
          />
        )}
      </main>
    </div>
  )
}

/* ============================================================
   TODAY VIEW
   ============================================================ */

function TodayView({
  selectedDate,
  setSelectedDate,
  diyaTasks,
  hamzahTasks,
  diyaOverflow,
  hamzahOverflow,
  allTasks,
  currentHamzahChapter,
  toggleTask,
  logSession,
  seedDay
}) {
  const week = getWeekDates(selectedDate)

  const diyaPhase = getPhase(
    config.diya?.phases || [],
    selectedDate
  )

  const hamzahPhase = getPhase(
    config.hamzah?.phases || [],
    selectedDate
  )

  const hamzahRamp = getHamzahRamp(selectedDate)

  return (
    <>
      <div className="card weekSummary">
        <div className="weekTitle">
          <div>
            <small>STUDY WEEK</small>
            <h2>
              {formatDate(week[0])} –{' '}
              {formatDate(week[6], {
                year: true
              })}
            </h2>
          </div>

          <div className="weekStats">
            <span>
              Exam{' '}
              <b>
                {formatDate(EXAM_DATE, {
                  year: true
                })}
              </b>
            </span>
          </div>
        </div>

        <div className="weekDays">
          {week.map(date => {
            const dayTasks = allTasks.filter(
              task => task.task_date === date
            )

            const done =
              dayTasks.length > 0 &&
              dayTasks.every(
                task =>
                  task.completed ||
                  task.task_type === 'Chapter'
              )

            const missed =
              date < localISO() &&
              dayTasks.some(
                task =>
                  !task.completed &&
                  task.task_type !== 'Chapter'
              )

            return (
              <button
                key={date}
                className={[
                  selectedDate === date
                    ? 'selected'
                    : '',
                  date === localISO()
                    ? 'current'
                    : '',
                  missed ? 'missed' : '',
                  done ? 'complete' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  setSelectedDate(date)
                  seedDay(date)
                }}
              >
                <small>
                  {dateFromISO(
                    date
                  ).toLocaleDateString(
                    'en-US',
                    {
                      weekday: 'short'
                    }
                  )}
                </small>

                <b>
                  {dateFromISO(date).getDate()}
                </b>

                <span>
                  {dayTasks.filter(
                    task => task.completed
                  ).length}
                  /{dayTasks.length || 0}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <StudentHeader
        name="Diya"
        subtitle={`${
          STUDENTS.Diya.track
        } • ${STUDENTS.Diya.target}+ Target`}
        badge="5–6 HOURS / DAY"
      />

      <StudentDashboard
        student="Diya"
        date={selectedDate}
        phase={diyaPhase}
        tasks={diyaTasks}
        overflow={diyaOverflow}
        toggleTask={toggleTask}
        logSession={logSession}
      />

      <div className="studentDivider" />

      <StudentHeader
        name="Hamzah"
        subtitle={`${
          STUDENTS.Hamzah.track
        } • ${STUDENTS.Hamzah.target}+ Target`}
        badge={
          hamzahRamp?.label ||
          'FULL MCAT WORKLOAD'
        }
      />

      <HamzahDashboard
        date={selectedDate}
        phase={hamzahPhase}
        ramp={hamzahRamp}
        tasks={hamzahTasks}
        overflow={hamzahOverflow}
        chapter={currentHamzahChapter}
        toggleTask={toggleTask}
        logSession={logSession}
      />
    </>
  )
}

/* ============================================================
   STUDENT HEADER
   ============================================================ */

function StudentHeader({
  name,
  subtitle,
  badge
}) {
  return (
    <div className="studentHeader">
      <div>
        <small>STUDENT</small>
        <h2>{name}</h2>
        <p>{subtitle}</p>
      </div>

      <strong>{badge}</strong>
    </div>
  )
}

/* ============================================================
   DIYA DASHBOARD
   ============================================================ */

function StudentDashboard({
  student,
  date,
  phase,
  tasks,
  overflow,
  toggleTask,
  logSession
}) {
  const minutes = taskMinutes(tasks)
  const completed = tasks.filter(
    task => task.completed
  ).length

  const progress = taskProgress(tasks)
  const overflowMinutes = taskMinutes(overflow)

  return (
    <>
      <OverflowPanel
        student={student}
        overflow={overflow}
        toggleTask={toggleTask}
      />

      <div className="todayHeading">
        <div>
          <small>
            {phase?.name?.toUpperCase() ||
              'STUDY PLAN'}
          </small>

          <h2>
            {formatDate(date, {
              weekday: true,
              year: true
            })}
          </h2>

          <p>
            {phase?.notes ||
              'Follow the scheduled study plan.'}
          </p>
        </div>

        <div className="todayMetrics">
          <span>
            <small>PLANNED</small>
            <b>{formatMinutes(minutes)}</b>
          </span>

          <span>
            <small>DONE</small>
            <b>
              {completed}/{tasks.length}
            </b>
          </span>

          <span>
            <small>OVERFLOW</small>
            <b>
              {formatMinutes(
                overflowMinutes
              )}
            </b>
          </span>
        </div>
      </div>

      <ProgressCard
        progress={progress}
        completed={completed}
        total={tasks.length}
        minutes={minutes}
      />

      <div className="dashboardGrid">
        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>TODAY'S CHECKLIST</small>
              <h2>Diya's Work</h2>
            </div>

            <span>
              {phase?.primary_resource ||
                'MCAT'}
            </span>
          </div>

          <div className="taskList">
            {tasks.length ? (
              tasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={toggleTask}
                />
              ))
            ) : (
              <p className="empty">
                No scheduled tasks for this
                date.
              </p>
            )}
          </div>
        </div>

        <Pomodoro
          student="Diya"
          onLog={logSession}
        />
      </div>
    </>
  )
}

/* ============================================================
   HAMZAH DASHBOARD
   ============================================================ */

function HamzahDashboard({
  date,
  phase,
  ramp,
  tasks,
  overflow,
  chapter,
  toggleTask,
  logSession
}) {
  const minutes = taskMinutes(tasks)
  const completed = tasks.filter(
    task => task.completed
  ).length

  const progress = taskProgress(tasks)
  const overflowMinutes = taskMinutes(overflow)

  const completedChapters =
    getCompletedHamzahChapterSequences(
      tasks
    ).size

  return (
    <>
      <OverflowPanel
        student="Hamzah"
        overflow={overflow}
        toggleTask={toggleTask}
      />

      <div className="card hamxahHero">
        <div className="contentHero">
          <div>
            <small>
              {ramp?.label?.toUpperCase() ||
                phase?.name?.toUpperCase() ||
                'CONTENT + QUESTIONS'}
            </small>

            <h2>
              {phase?.name ||
                'Hamzah MCAT Plan'}
            </h2>

            <p>
              {ramp?.notes ||
                phase?.notes ||
                'Build content knowledge while steadily increasing question practice.'}
            </p>
          </div>

          <div className="chapterCounter">
            <b>{chapter?.sequence || 58}</b>
            <span>/ 58</span>
          </div>
        </div>

        {chapter && (
          <div className="activeChapterCard">
            <small>
              CURRENT KAPLAN CHAPTER
            </small>

            <h2>
              {chapter.subject} Ch.{' '}
              {chapter.chapter}
            </h2>

            <p>{chapter.title}</p>
          </div>
        )}
      </div>

      <div className="todayHeading">
        <div>
          <small>
            {ramp?.label?.toUpperCase() ||
              phase?.name?.toUpperCase() ||
              'HAMZAH'}
          </small>

          <h2>
            {formatDate(date, {
              weekday: true,
              year: true
            })}
          </h2>

          <p>
            {ramp?.target_minutes
              ? `Target workload: approximately ${formatMinutes(
                  ramp.target_minutes
                )}.`
              : 'Full MCAT study workload.'}
          </p>
        </div>

        <div className="todayMetrics">
          <span>
            <small>PLANNED</small>
            <b>{formatMinutes(minutes)}</b>
          </span>

          <span>
            <small>DONE</small>
            <b>
              {completed}/{tasks.length}
            </b>
          </span>

          <span>
            <small>OVERFLOW</small>
            <b>
              {formatMinutes(
                overflowMinutes
              )}
            </b>
          </span>
        </div>
      </div>

      <ProgressCard
        progress={progress}
        completed={completed}
        total={tasks.length}
        minutes={minutes}
      />

      <div className="dashboardGrid">
        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>TODAY'S CHECKLIST</small>
              <h2>Hamzah's Work</h2>
            </div>

            <span>
              {phase?.question_resource ||
                phase?.primary_resource ||
                'Kaplan'}
            </span>
          </div>

          <div className="taskList">
            {tasks.length ? (
              tasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={toggleTask}
                />
              ))
            ) : (
              <p className="empty">
                No scheduled tasks for this
                date.
              </p>
            )}
          </div>
        </div>

        <Pomodoro
          student="Hamzah"
          onLog={logSession}
        />
      </div>
    </>
  )
}

/* ============================================================
   OVERFLOW PANEL
   ============================================================ */

function OverflowPanel({
  student,
  overflow,
  toggleTask
}) {
  if (!overflow.length) return null

  const minutes = taskMinutes(overflow)

  const level =
    minutes >=
    (config.global_rules
      ?.overflow_critical_minutes || 240)
      ? 'critical'
      : minutes >=
          (config.global_rules
            ?.overflow_warning_minutes ||
            120)
        ? 'warning'
        : ''

  return (
    <div
      className={`card overflowPanel ${level}`}
    >
      <div className="sectionTitle">
        <div>
          <small>
            {student.toUpperCase()} OVERFLOW
          </small>

          <h2>Carried Work</h2>
        </div>

        <strong>
          {formatMinutes(minutes)}
        </strong>
      </div>

      <p>
        Complete important carried work before
        lower-priority new work.
      </p>

      <div className="taskList">
        {overflow.map(task => (
          <TaskRow
            key={`overflow-${task.id}`}
            task={task}
            onToggle={toggleTask}
            overflow
          />
        ))}
      </div>
    </div>
  )
}

/* ============================================================
   TASK ROW
   ============================================================ */

function TaskRow({
  task,
  onToggle,
  overflow = false
}) {
  return (
    <div
      className={[
        'task',
        task.completed ? 'completed' : '',
        overflow ? 'overflowTask' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        className={`taskCheck ${
          task.completed ? 'done' : ''
        }`}
        onClick={() => onToggle(task)}
        title={
          task.completed
            ? 'Mark incomplete'
            : 'Mark complete'
        }
      >
        {task.completed ? '✓' : ''}
      </button>

      <div className="taskBody">
        <small>
          {overflow
            ? `OVERFLOW • ${task.task_type}`
            : task.task_type}
        </small>

        <b>{task.title}</b>

        {task.description && (
          <span>{task.description}</span>
        )}

        {Number(task.estimated_minutes) >
          0 && (
          <span>
            {formatMinutes(
              task.estimated_minutes
            )}
            {task.resource
              ? ` • ${task.resource}`
              : ''}
          </span>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   PROGRESS CARD
   ============================================================ */

function ProgressCard({
  progress,
  completed,
  total,
  minutes
}) {
  return (
    <div className="card progressCard">
      <div>
        <b>Daily Progress</b>
        <span>
          {completed} of {total} tasks complete
          • {formatMinutes(minutes)} planned
        </span>
      </div>

      <strong>{progress}%</strong>

      <div className="progress">
        <i
          style={{
            width: `${progress}%`
          }}
        />
      </div>
    </div>
  )
}

/* ============================================================
   POMODORO
   ============================================================ */

function Pomodoro({
  student,
  onLog
}) {
  const [mode, setMode] = useState('Focus')
  const [focusMinutes, setFocusMinutes] =
    useState(50)
  const [breakMinutes, setBreakMinutes] =
    useState(10)

  const [seconds, setSeconds] = useState(
    focusMinutes * 60
  )

  const [running, setRunning] =
    useState(false)

  const intervalRef = useRef(null)

  useEffect(() => {
    if (!running) {
      setSeconds(
        (mode === 'Focus'
          ? focusMinutes
          : breakMinutes) * 60
      )
    }
  }, [
    focusMinutes,
    breakMinutes,
    mode
  ])

  useEffect(() => {
    if (!running) {
      clearInterval(intervalRef.current)
      return
    }

    intervalRef.current = setInterval(() => {
      setSeconds(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current)
          setRunning(false)

          if (mode === 'Focus') {
            onLog(
              student,
              focusMinutes,
              'Pomodoro'
            )
          }

          return 0
        }

        return prev - 1
      })
    }, 1000)

    return () =>
      clearInterval(intervalRef.current)
  }, [
    running,
    mode,
    focusMinutes,
    student,
    onLog
  ])

  function switchMode(nextMode) {
    setRunning(false)
    setMode(nextMode)
    setSeconds(
      (nextMode === 'Focus'
        ? focusMinutes
        : breakMinutes) * 60
    )
  }

  function reset() {
    setRunning(false)

    setSeconds(
      (mode === 'Focus'
        ? focusMinutes
        : breakMinutes) * 60
    )
  }

  const mins = String(
    Math.floor(seconds / 60)
  ).padStart(2, '0')

  const secs = String(
    seconds % 60
  ).padStart(2, '0')

  return (
    <div className="card pomodoro">
      <div className="sectionTitle">
        <div>
          <small>
            {student.toUpperCase()}
          </small>
          <h2>Pomodoro</h2>
        </div>

        <span>{mode}</span>
      </div>

      <div className="timer">
        {mins}:{secs}
      </div>

      <div className="timerModes">
        <button
          onClick={() =>
            switchMode('Focus')
          }
        >
          Focus
        </button>

        <button
          onClick={() =>
            switchMode('Break')
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
            onChange={e =>
              setFocusMinutes(
                Number(e.target.value) || 1
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
            onChange={e =>
              setBreakMinutes(
                Number(e.target.value) || 1
              )
            }
          />
        </label>
      </div>

      <button
        className="timerButton"
        onClick={() =>
          setRunning(prev => !prev)
        }
      >
        {running ? 'Pause' : 'Start'}
      </button>

      <button
        className="secondary"
        onClick={reset}
        style={{ marginTop: 8 }}
      >
        Reset
      </button>
    </div>
  )
}

/* ============================================================
   CALENDAR
   ============================================================ */

function CalendarView({
  selectedDate,
  setSelectedDate,
  tasks
}) {
  const [monthOffset, setMonthOffset] =
    useState(0)

  const base = dateFromISO(selectedDate)

  const month = new Date(
    base.getFullYear(),
    base.getMonth() + monthOffset,
    1
  )

  const year = month.getFullYear()
  const monthIndex = month.getMonth()

  const first = new Date(
    year,
    monthIndex,
    1
  )

  const last = new Date(
    year,
    monthIndex + 1,
    0
  )

  const dates = []

  for (
    let day = 1;
    day <= last.getDate();
    day++
  ) {
    dates.push(
      localISO(
        new Date(year, monthIndex, day)
      )
    )
  }

  return (
    <div className="card">
      <div className="sectionTitle">
        <div>
          <small>STUDY CALENDAR</small>

          <h2>
            {month.toLocaleDateString(
              'en-US',
              {
                month: 'long',
                year: 'numeric'
              }
            )}
          </h2>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 6
          }}
        >
          <button
            className="secondary"
            onClick={() =>
              setMonthOffset(v => v - 1)
            }
          >
            ←
          </button>

          <button
            className="secondary"
            onClick={() =>
              setMonthOffset(v => v + 1)
            }
          >
            →
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(7, 1fr)',
          gap: 7,
          marginBottom: 7
        }}
      >
        {[
          'Sun',
          'Mon',
          'Tue',
          'Wed',
          'Thu',
          'Fri',
          'Sat'
        ].map(day => (
          <small
            key={day}
            style={{
              textAlign: 'center',
              opacity: 0.6
            }}
          >
            {day}
          </small>
        ))}
      </div>

      <div
        className="calendarGrid"
        style={{
          paddingLeft: `calc(${
            first.getDay()
          } * ((100% - 42px) / 7 + 7px))`
        }}
      >
        {dates.map(date => {
          const dayTasks = tasks.filter(
            task => task.task_date === date
          )

          const realTasks = dayTasks.filter(
            task =>
              task.task_type !== 'Chapter'
          )

          const complete =
            realTasks.length > 0 &&
            realTasks.every(
              task => task.completed
            )

          const missed =
            date < localISO() &&
            realTasks.some(
              task => !task.completed
            )

          const future =
            date > localISO()

          const diyaDone =
            dayTasks.filter(
              task =>
                task.student_name ===
                  'Diya' &&
                task.completed
            ).length

          const diyaTotal =
            dayTasks.filter(
              task =>
                task.student_name ===
                  'Diya' &&
                task.task_type !== 'Chapter'
            ).length

          const hamzahDone =
            dayTasks.filter(
              task =>
                task.student_name ===
                  'Hamzah' &&
                task.completed
            ).length

          const hamzahTotal =
            dayTasks.filter(
              task =>
                task.student_name ===
                  'Hamzah' &&
                task.task_type !== 'Chapter'
            ).length

          return (
            <button
              key={date}
              className={[
                date === localISO()
                  ? 'current'
                  : '',
                complete ? 'complete' : '',
                missed ? 'missed' : '',
                future ? 'future' : ''
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
                  'en-US',
                  {
                    weekday: 'short'
                  }
                )}
              </small>

              <b>
                {dateFromISO(date).getDate()}
              </b>

              <span>
                D {diyaDone}/{diyaTotal}
              </span>

              <span>
                H {hamzahDone}/
                {hamzahTotal}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ============================================================
   QUESTIONS
   ============================================================ */

function QuestionsView({
  logs,
  onAdd
}) {
  const [student, setStudent] =
    useState('Diya')
  const [date, setDate] =
    useState(localISO())
  const [source, setSource] =
    useState('UWorld')
  const [subject, setSubject] =
    useState('B/B')
  const [total, setTotal] = useState(20)
  const [correct, setCorrect] =
    useState(0)
  const [timed, setTimed] =
    useState(true)

  async function submit(e) {
    e.preventDefault()

    await onAdd({
      student,
      date,
      source,
      subject,
      total,
      correct,
      timed
    })

    setCorrect(0)
  }

  return (
    <div className="dashboardGrid">
      <form
        className="card form"
        onSubmit={submit}
      >
        <div className="sectionTitle">
          <div>
            <small>QUESTION LOG</small>
            <h2>Add Practice Block</h2>
          </div>
        </div>

        <label>
          Student
          <select
            value={student}
            onChange={e =>
              setStudent(e.target.value)
            }
          >
            <option>Diya</option>
            <option>Hamzah</option>
          </select>
        </label>

        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={e =>
              setDate(e.target.value)
            }
          />
        </label>

        <label>
          Resource
          <select
            value={source}
            onChange={e =>
              setSource(e.target.value)
            }
          >
            <option>Kaplan</option>
            <option>Kaplan QBank</option>
            <option>UWorld</option>
            <option>AAMC</option>
            <option>AAMC Section Bank</option>
            <option>AAMC Question Pack</option>
            <option>Other</option>
          </select>
        </label>

        <label>
          Section
          <select
            value={subject}
            onChange={e =>
              setSubject(e.target.value)
            }
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
            type="number"
            min="1"
            value={total}
            onChange={e =>
              setTotal(e.target.value)
            }
          />
        </label>

        <label>
          Correct
          <input
            type="number"
            min="0"
            max={total}
            value={correct}
            onChange={e =>
              setCorrect(e.target.value)
            }
          />
        </label>

        <label className="checkboxLabel">
          <input
            type="checkbox"
            checked={timed}
            onChange={e =>
              setTimed(e.target.checked)
            }
          />
          Timed
        </label>

        <button type="submit">
          Save Question Block
        </button>
      </form>

      <div className="card">
        <div className="sectionTitle">
          <div>
            <small>RECENT PRACTICE</small>
            <h2>Question History</h2>
          </div>
        </div>

        <div className="logList">
          {logs.length ? (
            logs.slice(0, 30).map(log => {
              const pct =
                Number(log.total_questions) >
                0
                  ? Math.round(
                      (Number(
                        log.correct_questions
                      ) /
                        Number(
                          log.total_questions
                        )) *
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
                      {formatDate(
                        log.question_date
                      )}{' '}
                      • {log.source}
                    </small>

                    <b>
                      {log.subject} •{' '}
                      {
                        log.correct_questions
                      }
                      /{log.total_questions}
                    </b>
                  </div>

                  <strong>{pct}%</strong>
                </div>
              )
            })
          ) : (
            <p className="empty">
              No question blocks logged yet.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   FULL LENGTHS
   ============================================================ */

function FullLengthView({
  fullLengths,
  onAdd
}) {
  const [student, setStudent] =
    useState('Diya')
  const [date, setDate] =
    useState(localISO())
  const [name, setName] =
    useState('AAMC FL')
  const [cp, setCp] = useState(125)
  const [cars, setCars] =
    useState(125)
  const [bb, setBb] = useState(125)
  const [ps, setPs] = useState(125)

  async function submit(e) {
    e.preventDefault()

    await onAdd({
      student,
      date,
      name,
      cp,
      cars,
      bb,
      ps
    })
  }

  return (
    <>
      <div className="card togetherHero">
        <small>SHARED MILESTONES</small>
        <h2>
          Synchronized Full-Lengths
        </h2>

        <p>
          Diya and Hamzah take scheduled
          full-lengths on the same day and
          perform deep review the following
          day.
        </p>
      </div>

      <div className="dashboardGrid">
        <form
          className="card form"
          onSubmit={submit}
        >
          <div className="sectionTitle">
            <div>
              <small>FULL LENGTH</small>
              <h2>Log Score</h2>
            </div>
          </div>

          <label>
            Student
            <select
              value={student}
              onChange={e =>
                setStudent(e.target.value)
              }
            >
              <option>Diya</option>
              <option>Hamzah</option>
            </select>
          </label>

          <label>
            Exam Date
            <input
              type="date"
              value={date}
              onChange={e =>
                setDate(e.target.value)
              }
            />
          </label>

          <label>
            Exam
            <input
              value={name}
              onChange={e =>
                setName(e.target.value)
              }
            />
          </label>

          <label>
            C/P
            <input
              type="number"
              min="118"
              max="132"
              value={cp}
              onChange={e =>
                setCp(e.target.value)
              }
            />
          </label>

          <label>
            CARS
            <input
              type="number"
              min="118"
              max="132"
              value={cars}
              onChange={e =>
                setCars(e.target.value)
              }
            />
          </label>

          <label>
            B/B
            <input
              type="number"
              min="118"
              max="132"
              value={bb}
              onChange={e =>
                setBb(e.target.value)
              }
            />
          </label>

          <label>
            P/S
            <input
              type="number"
              min="118"
              max="132"
              value={ps}
              onChange={e =>
                setPs(e.target.value)
              }
            />
          </label>

          <button type="submit">
            Save Full Length
          </button>
        </form>

        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>SCORE HISTORY</small>
              <h2>Full Lengths</h2>
            </div>
          </div>

          <div className="flList">
            {fullLengths.length ? (
              fullLengths.map(fl => (
                <div
                  className="flRow"
                  key={fl.id}
                >
                  <div>
                    <small>
                      {formatDate(
                        fl.exam_date
                      )}
                    </small>

                    <b>{fl.exam_name}</b>

                    <span>
                      C/P {fl.cp_score} •
                      CARS {fl.cars_score} •
                      B/B {fl.bb_score} •
                      P/S {fl.ps_score}
                    </span>
                  </div>

                  <strong>
                    {fl.total_score}
                  </strong>
                </div>
              ))
            ) : (
              <p className="empty">
                No full lengths logged yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/* ============================================================
   TOGETHER
   ============================================================ */

function TogetherView({
  selectedDate,
  tasks,
  sessions
}) {
  const flDates =
    config.shared?.full_length_dates || []

  return (
    <>
      <div className="card togetherHero">
        <small>
          DIYA + HAMZAH
        </small>

        <h2>Study Together</h2>

        <p>
          One MCAT date, two individual
          checklists. Shared milestones are
          used for full lengths, full-length
          review, CARS, weakness review, and
          study sessions.
        </p>
      </div>

      <div className="dashboardGrid">
        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>FULL LENGTH PLAN</small>
              <h2>Scheduled Exams</h2>
            </div>
          </div>

          <div className="partnerList">
            {flDates.map((date, i) => (
              <div
                className="partnerRow"
                key={date}
              >
                <div>
                  <small>
                    FULL LENGTH {i + 1}
                  </small>
                  <b>
                    {formatDate(date, {
                      weekday: true,
                      year: true
                    })}
                  </b>
                </div>

                <strong>
                  {date < localISO()
                    ? 'PAST'
                    : date === localISO()
                      ? 'TODAY'
                      : `${daysBetween(
                          localISO(),
                          date
                        )} DAYS`}
                </strong>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>FOCUS TIME</small>
              <h2>Recent Sessions</h2>
            </div>
          </div>

          <div className="logList">
            {sessions.length ? (
              sessions
                .slice(0, 20)
                .map(session => (
                  <div
                    className="logRow"
                    key={session.id}
                  >
                    <div>
                      <small>
                        {formatDate(
                          session.session_date
                        )}
                      </small>

                      <b>
                        {session.session_type}
                      </b>
                    </div>

                    <strong>
                      {formatMinutes(
                        session.actual_minutes
                      )}
                    </strong>
                  </div>
                ))
            ) : (
              <p className="empty">
                No focus sessions logged yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/* ============================================================
   ANALYTICS
   ============================================================ */

function AnalyticsView({
  tasks,
  questionLogs,
  fullLengths,
  sessions
}) {
  const diyaTasks = tasks.filter(
    task => task.student_name === 'Diya'
  )

  const hamzahTasks = tasks.filter(
    task => task.student_name === 'Hamzah'
  )

  const diyaDone = diyaTasks.filter(
    task => task.completed
  ).length

  const hamzahDone = hamzahTasks.filter(
    task => task.completed
  ).length

  const totalQuestions =
    questionLogs.reduce(
      (sum, log) =>
        sum +
        (Number(log.total_questions) ||
          0),
      0
    )

  const totalCorrect =
    questionLogs.reduce(
      (sum, log) =>
        sum +
        (Number(log.correct_questions) ||
          0),
      0
    )

  const accuracy = totalQuestions
    ? Math.round(
        (totalCorrect / totalQuestions) *
          100
      )
    : 0

  const focusMinutes = sessions.reduce(
    (sum, session) =>
      sum +
      (Number(session.actual_minutes) ||
        0),
    0
  )

  const bestFL = fullLengths.length
    ? Math.max(
        ...fullLengths.map(
          fl =>
            Number(fl.total_score) || 0
        )
      )
    : 0

  return (
    <div className="analyticsGrid">
      <MetricCard
        label="DIYA COMPLETION"
        value={
          diyaTasks.length
            ? `${Math.round(
                (diyaDone /
                  diyaTasks.length) *
                  100
              )}%`
            : '0%'
        }
        detail={`${diyaDone}/${diyaTasks.length} tasks`}
      />

      <MetricCard
        label="HAMZAH COMPLETION"
        value={
          hamzahTasks.length
            ? `${Math.round(
                (hamzahDone /
                  hamzahTasks.length) *
                  100
              )}%`
            : '0%'
        }
        detail={`${hamzahDone}/${hamzahTasks.length} tasks`}
      />

      <MetricCard
        label="QUESTIONS LOGGED"
        value={totalQuestions}
        detail={`${accuracy}% overall accuracy`}
      />

      <MetricCard
        label="FOCUS TIME"
        value={formatMinutes(focusMinutes)}
        detail={`${sessions.length} sessions`}
      />

      <MetricCard
        label="BEST FL"
        value={bestFL || '—'}
        detail={`${fullLengths.length} exams logged`}
      />
    </div>
  )
}

function MetricCard({
  label,
  value,
  detail
}) {
  return (
    <div className="card statCard">
      <small>{label}</small>
      <b>{value}</b>
      <span>{detail}</span>
    </div>
  )
}
