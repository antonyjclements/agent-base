#!/usr/bin/env node
import { dispatch } from '../cli/dispatch.mjs'

process.exitCode = await dispatch(process.argv.slice(2))
